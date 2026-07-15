const express = require('express');
const { query } = require('../../config/db');
const { verifyWebhookSignature } = require('./imb');
const { creditDepositFromOrder } = require('../wallet/service');

const router = express.Router();

router.post(
  '/',
  express.raw({ type: '*/*' }),
  async (req, res, next) => {
    try {
      const raw =
        Buffer.isBuffer(req.body) || typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body || {});
      const signature =
        req.headers['x-imb-signature'] || req.headers['x-signature'];
      if (!verifyWebhookSignature(raw, signature)) {
        return res.status(401).json({ ok: false, error: 'BAD_SIGNATURE' });
      }
      const payload = JSON.parse(
        Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
      );
      const imbRef = payload.imb_ref || payload.ref || payload.transaction_id;
      const orderId = payload.order_id || payload.orderId;
      let id = orderId ? Number(orderId) : null;
      if (!id && imbRef) {
        const rows = await query(
          `SELECT id FROM payment_orders WHERE imb_ref = :imbRef LIMIT 1`,
          { imbRef }
        );
        id = rows[0]?.id ? Number(rows[0].id) : null;
      }
      if (!id) {
        return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
      }
      const result = await creditDepositFromOrder(id, imbRef);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
