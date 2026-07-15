const { withTransaction } = require('../../config/db');
const cache = require('../../config/redis');

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
       WHERE id = ?`,
      [imbRef || null, orderId]
    );
    await cache.del(`wallet:${order.user_id}`);
    return { credited: true, balance };
  });
}

module.exports = { creditDepositFromOrder };
