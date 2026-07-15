const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { createPayment } = require('../payments/imb');
const { creditDepositFromOrder } = require('./service');
const { config } = require('../../config/env');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const cacheKey = `wallet:${req.user.id}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json({ ok: true, ...cached, cached: true });

    const rows = await query(
      `SELECT balance FROM wallets WHERE user_id = :userId LIMIT 1`,
      { userId: req.user.id }
    );
    const balance = rows[0] ? Number(rows[0].balance) : 0;
    const payload = { balance };
    await cache.set(cacheKey, payload, 15);
    res.json({ ok: true, ...payload });
  } catch (err) {
    next(err);
  }
});

router.get('/ledger', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const rows = await query(
      `SELECT id, type, amount, balance_after AS balanceAfter, note, created_at AS createdAt
       FROM wallet_ledger
       WHERE user_id = :userId
         AND (:cursor IS NULL OR id < :cursor)
       ORDER BY id DESC
       LIMIT ${limit}`,
      { userId: req.user.id, cursor }
    );
    const nextCursor = rows.length ? rows[rows.length - 1].id : null;
    res.json({ ok: true, items: rows, nextCursor });
  } catch (err) {
    next(err);
  }
});

router.post('/deposit', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const body = z
      .object({ amount: z.number().positive().max(500000) })
      .parse(req.body);

    const result = await query(
      `INSERT INTO payment_orders (user_id, amount, status, merchant_id)
       VALUES (:userId, :amount, 'pending', :merchantId)`,
      {
        userId: req.user.id,
        amount: body.amount,
        merchantId: config.imb.merchantId,
      }
    );
    const orderId = result.insertId;
    const pay = await createPayment({
      orderId,
      amount: body.amount,
      userId: req.user.id,
    });
    await query(
      `UPDATE payment_orders
       SET imb_ref = :imbRef, pay_url = :payUrl, qr_payload = :qr
       WHERE id = :id`,
      {
        imbRef: pay.imbRef,
        payUrl: pay.payUrl,
        qr: pay.qrPayload,
        id: orderId,
      }
    );

    if (config.imb.mock) {
      await creditDepositFromOrder(orderId, pay.imbRef);
    }

    res.status(201).json({
      ok: true,
      orderId,
      amount: body.amount,
      payUrl: pay.payUrl,
      qrPayload: pay.qrPayload,
      imbRef: pay.imbRef,
      mockAutoCredited: config.imb.mock,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/withdraw', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const body = z
      .object({
        amount: z.number().positive().max(500000),
        note: z.string().max(255).optional(),
      })
      .parse(req.body);

    const out = await withTransaction(async (conn) => {
      const [wallets] = await conn.execute(
        `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
        [req.user.id]
      );
      const wallet = wallets[0];
      if (!wallet || Number(wallet.balance) < body.amount) {
        const err = new Error('Insufficient wallet balance');
        err.status = 400;
        err.code = 'INSUFFICIENT_FUNDS';
        throw err;
      }
      const balance = Number(wallet.balance) - body.amount;
      await conn.execute(
        `UPDATE wallets SET balance = ?, version = version + 1 WHERE user_id = ?`,
        [balance, req.user.id]
      );
      await conn.execute(
        `INSERT INTO wallet_ledger
          (user_id, type, amount, balance_after, note, ref_type)
         VALUES (?, 'withdraw', ?, ?, ?, 'withdraw_request')`,
        [req.user.id, body.amount, balance, body.note || 'Withdraw request']
      );
      const [wr] = await conn.execute(
        `INSERT INTO withdraw_requests (user_id, amount, status, note)
         VALUES (?, ?, 'pending', ?)`,
        [req.user.id, body.amount, body.note || null]
      );
      return { balance, withdrawId: wr.insertId };
    });

    await cache.del(`wallet:${req.user.id}`);
    res.status(201).json({ ok: true, ...out });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
