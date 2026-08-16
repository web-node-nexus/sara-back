const express = require('express');
const { query, withTransaction } = require('../../config/db');
const cache = require('../../config/redis');
const { checkPayoutStatus } = require('./imb');

const router = express.Router();

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : String(req.body || '');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }
}

async function refundWithdraw(conn, wr, note) {
  const [wallets] = await conn.execute(
    `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
    [wr.user_id]
  );
  if (!wallets[0]) return null;
  const balance = Number(wallets[0].balance) + Number(wr.amount);
  await conn.execute(
    `UPDATE wallets SET balance = ?, version = version + 1 WHERE user_id = ?`,
    [balance, wr.user_id]
  );
  await conn.execute(
    `INSERT INTO wallet_ledger
      (user_id, type, amount, balance_after, note, ref_type, ref_id)
     VALUES (?, 'adjust', ?, ?, ?, 'withdraw_request', ?)`,
    [wr.user_id, wr.amount, balance, note, String(wr.id)]
  );
  await cache.del(`wallet:${wr.user_id}`);
  return balance;
}

router.post(
  '/',
  express.urlencoded({ extended: true }),
  express.json({ limit: '1mb' }),
  express.text({ type: '*/*', limit: '1mb' }),
  async (req, res, next) => {
    try {
      const payload = parseBody(req);
      const data = payload.data || payload;
      const clientRef =
        data.client_ref_id ||
        data.reference_id ||
        data.refrence ||
        payload.client_ref_id ||
        payload.RequestId;
      const statusRaw = String(
        data.status || payload.status || ''
      ).toLowerCase();

      if (!clientRef) {
        return res.status(200).json({ ok: false, error: 'NO_REF' });
      }

      const rows = await query(
        `SELECT * FROM withdraw_requests
         WHERE client_ref_id = :ref OR id = :id
         LIMIT 1`,
        {
          ref: String(clientRef),
          id: Number(String(clientRef).replace(/\D/g, '')) || 0,
        }
      );
      const wr = rows[0];
      if (!wr) {
        return res.status(200).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (wr.status === 'paid' || wr.status === 'rejected') {
        return res.status(200).json({ ok: true, already: wr.status });
      }

      // Prefer CheckStatus when we have a ref
      let paid = statusRaw === 'success';
      let failed =
        statusRaw === 'fail' ||
        statusRaw === 'failed' ||
        statusRaw === 'reversed';
      try {
        const checked = await checkPayoutStatus(wr.client_ref_id || clientRef);
        if (checked.paid) paid = true;
        if (checked.failed) failed = true;
      } catch {
        /* use webhook status */
      }

      if (paid) {
        await query(
          `UPDATE withdraw_requests
           SET status = 'paid',
               payout_status = 'Success',
               payout_txn_id = COALESCE(:txn, payout_txn_id)
           WHERE id = :id`,
          {
            id: wr.id,
            txn: data.txn_id || data.utr_no || null,
          }
        );
        return res.status(200).json({ ok: true, status: 'paid' });
      }

      if (failed) {
        await withTransaction(async (conn) => {
          const [locked] = await conn.execute(
            `SELECT * FROM withdraw_requests WHERE id = ? FOR UPDATE`,
            [wr.id]
          );
          const row = locked[0];
          if (!row || row.status === 'paid' || row.status === 'rejected') return;
          await refundWithdraw(
            conn,
            row,
            'Withdraw payout failed — refund'
          );
          await conn.execute(
            `UPDATE withdraw_requests
             SET status = 'rejected', payout_status = ?
             WHERE id = ?`,
            [String(data.status || 'Fail'), wr.id]
          );
        });
        return res.status(200).json({ ok: true, status: 'rejected' });
      }

      res.status(200).json({ ok: true, status: 'ignored', rawStatus: statusRaw });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
