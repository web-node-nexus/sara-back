const { withTransaction, query } = require('../../config/db');
const cache = require('../../config/redis');
const { checkOrderStatus } = require('../payments/imb');
const { notifySystemEventAsync } = require('../../services/notificationService');

async function creditDepositFromOrder(orderId, imbRef) {
  return withTransaction(async (conn) => {
    const [orders] = await conn.execute(
      `SELECT id, user_id, amount, status FROM payment_orders
       WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    const order = orders[0];
    if (!order) return { skipped: true };
    if (order.status === 'paid') return { alreadyPaid: true };
    if (order.status !== 'pending') {
      return { skipped: true, reason: order.status };
    }

    const [wallets] = await conn.execute(
      `SELECT balance, version FROM wallets WHERE user_id = ? FOR UPDATE`,
      [order.user_id]
    );
    const wallet = wallets[0];
    if (!wallet) {
      const err = new Error('Wallet missing');
      err.status = 404;
      throw err;
    }
    const balance = Number(wallet.balance) + Number(order.amount);
    await conn.execute(
      `UPDATE wallets SET balance = ?, version = version + 1 WHERE user_id = ?`,
      [balance, order.user_id]
    );
    await conn.execute(
      `INSERT INTO wallet_ledger
        (user_id, type, amount, balance_after, note, ref_type, ref_id)
       VALUES (?, 'deposit', ?, ?, 'IMB merchant deposit', 'payment_order', ?)`,
      [order.user_id, order.amount, balance, String(orderId)]
    );
    await conn.execute(
      `UPDATE payment_orders SET status = 'paid', imb_ref = COALESCE(imb_ref, ?)
       WHERE id = ? AND status = 'pending'`,
      [imbRef || null, orderId]
    );
    await cache.del(`wallet:${order.user_id}`);
    return { credited: true, balance, userId: order.user_id, amount: Number(order.amount) };
  });
}

/**
 * Only credits when IMB check-order-status is Success/Completed.
 * Safe to call from webhook, poll API, or reconcile job.
 */
async function tryCreditIfImbPaid(orderId) {
  let verified;
  try {
    const rows = await query(
      `SELECT check_link AS checkLink FROM payment_orders WHERE id = :id LIMIT 1`,
      { id: orderId }
    );
    verified = await checkOrderStatus(orderId, {
      checkLink: rows[0]?.checkLink || null,
    });
  } catch (err) {
    // DNS / network blips must not 500 the poll — keep pending so app retries
    console.error(
      `[deposit] checkOrderStatus ${orderId}:`,
      err.message || err
    );
    return {
      credited: false,
      paid: false,
      failed: false,
      status: 'NETWORK_ERROR',
      message: err.message || 'IMB unreachable',
    };
  }
  if (verified.failed) {
    return {
      credited: false,
      paid: false,
      failed: true,
      status: verified.status,
      message: verified.message || null,
    };
  }
  if (!verified.paid) {
    return {
      credited: false,
      paid: false,
      failed: false,
      status: verified.status,
      message: verified.message || null,
    };
  }
  const result = await creditDepositFromOrder(
    orderId,
    verified.utr || String(orderId)
  );
  if (result.credited && result.userId) {
    notifySystemEventAsync({
      userId: result.userId,
      kind: 'deposit',
      title: 'Deposit Successful',
      message: `Rs.${Number(result.amount || verified.amount || 0).toLocaleString('en-IN')} credited to your wallet.`,
    });
  }
  return {
    ...result,
    paid: true,
    failed: false,
    status: verified.status,
    message: verified.message || null,
    amount: result.amount ?? verified.amount,
  };
}

module.exports = { creditDepositFromOrder, tryCreditIfImbPaid };
