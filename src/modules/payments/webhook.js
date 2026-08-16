const express = require('express');
const { query } = require('../../config/db');
const { tryCreditIfImbPaid } = require('../wallet/service');

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
    if (obj.result && typeof obj.result === 'string') {
      try {
        obj.result = JSON.parse(obj.result);
      } catch {
        /* keep string */
      }
    }
    return obj;
  }
}

function classifyPayload(payload) {
  const status = String(payload.status || '').toUpperCase();
  const result = payload.result || {};
  const txn = String(result.txnStatus || result.status || '').toUpperCase();
  const combined = `${status} ${txn}`;

  if (/FAIL|FAILED|FAILURE|CANCEL|FALSE|ERROR|REJECT|EXPIRED/.test(combined)) {
    return 'failed';
  }
  if (
    status === 'SUCCESS' ||
    status === 'COMPLETED' ||
    status === 'TRUE' ||
    status === 'PAID' ||
    txn === 'SUCCESS' ||
    txn === 'COMPLETED' ||
    txn === 'PAID'
  ) {
    return 'success';
  }
  // Scanning / Pending / Initiated — wait, do not fail or credit
  return 'pending';
}

router.post(
  '/',
  express.urlencoded({ extended: true }),
  express.json({ limit: '1mb' }),
  express.text({ type: '*/*', limit: '1mb' }),
  async (req, res, next) => {
    try {
      const payload = parseBody(req);
      const orderIdRaw =
        payload.order_id ||
        payload.orderId ||
        payload.result?.orderId ||
        payload.result?.order_id;
      const id = orderIdRaw != null ? Number(orderIdRaw) : NaN;
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(200).json({ ok: false, error: 'ORDER_NOT_FOUND' });
      }

      const kind = classifyPayload(payload);

      if (kind === 'failed') {
        await query(
          `UPDATE payment_orders SET status = 'failed' WHERE id = :id AND status = 'pending'`,
          { id }
        );
        return res.status(200).json({ ok: true, credited: false, reason: 'failed' });
      }

      if (kind === 'pending') {
        // Scanning etc. — never credit, never mark failed
        return res.status(200).json({
          ok: true,
          credited: false,
          reason: 'status_pending',
        });
      }

      // Webhook claims success → verify with IMB Check Status, credit only if paid
      const result = await tryCreditIfImbPaid(id);
      if (!result.paid) {
        return res.status(200).json({
          ok: true,
          credited: false,
          reason: result.failed ? 'failed' : 'status_pending',
          status: result.status,
        });
      }

      res.status(200).json({
        ok: true,
        credited: Boolean(result.credited || result.alreadyPaid),
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
