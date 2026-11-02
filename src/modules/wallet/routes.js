const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { createPayment } = require('../payments/imb');
const { creditDepositFromOrder, tryCreditIfImbPaid } = require('./service');
const { config } = require('../../config/env');
const {
  getAppSettings,
  validateDepositAmount,
  validateWithdrawRequest,
  countUserWithdrawsToday,
  withdrawPublicConfig,
} = require('../../services/appSettings');

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

    const settings = await getAppSettings();
    if (!settings.autoDepositStatus) {
      return res.status(403).json({
        ok: false,
        error: 'AUTO_DEPOSIT_DISABLED',
        message: 'Online deposit is disabled. Use manual UPI if available.',
      });
    }
    const range = validateDepositAmount(settings, body.amount);
    if (!range.ok) {
      return res.status(400).json({
        ok: false,
        error: 'AMOUNT_OUT_OF_RANGE',
        message: range.message,
        minDeposit: range.min,
        maxDeposit: range.max,
      });
    }

    const users = await query(
      `SELECT phone, name FROM users WHERE id = :id LIMIT 1`,
      { id: req.user.id }
    );
    const phone = users[0]?.phone || '9999999999';

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
      customerMobile: phone,
      remark1: users[0]?.name || `user-${req.user.id}`,
      remark2: `deposit:${orderId}`,
    });
    await query(
      `UPDATE payment_orders
       SET imb_ref = :imbRef,
           pay_url = :payUrl,
           qr_payload = :qr,
           phonepe_link = :phonepe,
           paytm_link = :paytm,
           check_link = :checkLink
       WHERE id = :id`,
      {
        imbRef: pay.imbRef,
        payUrl: pay.payUrl,
        qr: pay.qrPayload,
        phonepe: pay.phonepeLink || null,
        paytm: pay.paytmLink || null,
        checkLink: pay.checkLink || null,
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
      phonepeLink: pay.phonepeLink,
      paytmLink: pay.paytmLink,
      checkLink: pay.checkLink,
      imbRef: pay.imbRef,
      redirectUrl: config.imb.redirectUrl,
      mockAutoCredited: config.imb.mock,
      status: config.imb.mock ? 'paid' : 'pending',
    });
  } catch (err) {
    next(err);
  }
});

/** Poll deposit order — also re-checks IMB and credits if paid */
router.get(
  '/deposit/:orderId/status',
  requireAuth,
  requireRole('player'),
  async (req, res, next) => {
    try {
      const orderId = Number(req.params.orderId);
      const rows = await query(
        `SELECT id, user_id AS userId, amount, status, pay_url AS payUrl,
                qr_payload AS qrPayload, phonepe_link AS phonepeLink,
                paytm_link AS paytmLink
         FROM payment_orders
         WHERE id = :id AND user_id = :userId
         LIMIT 1`,
        { id: orderId, userId: req.user.id }
      );
      const order = rows[0];
      if (!order) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      let providerStatus = null;
      let providerMessage = null;
      if (order.status === 'pending') {
        const out = await tryCreditIfImbPaid(orderId);
        providerStatus = out.status || null;
        providerMessage = out.message || null;
        if (out.paid) {
          order.status = 'paid';
        } else if (out.failed) {
          await query(
            `UPDATE payment_orders SET status = 'failed' WHERE id = :id AND status = 'pending'`,
            { id: orderId }
          );
          order.status = 'failed';
        }
      }

      const wallets = await query(
        `SELECT balance FROM wallets WHERE user_id = :userId LIMIT 1`,
        { userId: req.user.id }
      );

      res.json({
        ok: true,
        orderId: order.id,
        amount: Number(order.amount),
        status: order.status,
        providerStatus,
        providerMessage,
        payUrl: order.payUrl,
        qrPayload: order.qrPayload,
        phonepeLink: order.phonepeLink,
        paytmLink: order.paytmLink,
        balance: wallets[0] ? Number(wallets[0].balance) : 0,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/payment-methods', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, type, label, bank_name AS bankName, account_name AS accountName,
              account_number AS accountNumber, ifsc, upi_id AS upiId
       FROM user_payment_methods
       WHERE user_id = :userId
       ORDER BY id DESC`,
      { userId: req.user.id }
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/payment-methods', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const body = z
      .object({
        type: z.enum(['bank', 'upi']),
        bankName: z.string().max(120).optional(),
        accountName: z.string().max(120).optional(),
        accountNumber: z.string().max(40).optional(),
        ifsc: z.string().max(20).optional(),
        upiId: z.string().max(120).optional(),
        label: z.string().max(120).optional(),
      })
      .parse(req.body);

    if (body.type === 'bank') {
      if (!body.accountNumber || !body.ifsc || !body.accountName) {
        return res.status(400).json({
          ok: false,
          error: 'BANK_REQUIRED',
          message: 'Account name, number and IFSC required',
        });
      }
    } else if (!body.upiId || !body.accountName) {
      return res.status(400).json({
        ok: false,
        error: 'UPI_REQUIRED',
        message: 'Name and UPI ID required',
      });
    }

    const result = await query(
      `INSERT INTO user_payment_methods
        (user_id, type, label, bank_name, account_name, account_number, ifsc, upi_id)
       VALUES
        (:userId, :type, :label, :bankName, :accountName, :accountNumber, :ifsc, :upiId)`,
      {
        userId: req.user.id,
        type: body.type,
        label: body.label || body.bankName || body.upiId || null,
        bankName: body.bankName || null,
        accountName: body.accountName || null,
        accountNumber: body.accountNumber || null,
        ifsc: body.ifsc ? body.ifsc.toUpperCase() : null,
        upiId: body.upiId || null,
      }
    );

    res.status(201).json({
      ok: true,
      item: {
        id: result.insertId,
        type: body.type,
        label: body.label || body.bankName || body.upiId || null,
        bankName: body.bankName || null,
        accountName: body.accountName || null,
        accountNumber: body.accountNumber || null,
        ifsc: body.ifsc ? body.ifsc.toUpperCase() : null,
        upiId: body.upiId || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/withdraw/eligibility', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const settings = await getAppSettings();
    const w = withdrawPublicConfig(settings);
    const todayCount = await countUserWithdrawsToday(req.user.id);
    const canWithdraw =
      w.status &&
      w.isOpenNow &&
      todayCount < Number(settings.withdrawAllowedPerDay || 1);
    let message = null;
    if (!w.status || !w.isOpenNow) {
      message = settings.withdrawCloseText || 'Cannot withdraw at this time';
    } else if (todayCount >= Number(settings.withdrawAllowedPerDay || 1)) {
      message = `Daily limit reached (${settings.withdrawAllowedPerDay}/day)`;
    }
    res.json({
      ok: true,
      canWithdraw,
      message,
      todayCount,
      allowedPerDay: settings.withdrawAllowedPerDay,
      ...w,
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
        upiId: z.string().max(120).optional(),
        accountName: z.string().max(120).optional(),
        accountNumber: z.string().max(40).optional(),
        ifsc: z.string().max(20).optional(),
        bankName: z.string().max(120).optional(),
      })
      .parse(req.body);

    const settings = await getAppSettings();
    const check = await validateWithdrawRequest(settings, body, req.user.id);
    if (!check.ok) {
      return res.status(400).json({
        ok: false,
        error: check.code || 'WITHDRAW_BLOCKED',
        message: check.message,
      });
    }

    const upi = (body.upiId || '').trim();
    const accountNumber = (body.accountNumber || '').trim();
    const ifsc = (body.ifsc || '').trim().toUpperCase();
    const accountName = (body.accountName || '').trim();
    const bankName = (body.bankName || '').trim();

    if (!upi && !(accountNumber && ifsc && accountName)) {
      return res.status(400).json({
        ok: false,
        error: 'PAYOUT_DETAILS_REQUIRED',
        message: 'Provide UPI ID or bank account (name, number, IFSC)',
      });
    }

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
        `INSERT INTO withdraw_requests
          (user_id, amount, status, note, upi_id, account_name, account_number, ifsc, bank_name)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          body.amount,
          body.note || null,
          upi || null,
          accountName || null,
          accountNumber || null,
          ifsc || null,
          bankName || null,
        ]
      );
      return { balance, withdrawId: wr.insertId };
    });

    await cache.del(`wallet:${req.user.id}`);
    res.status(201).json({
      ok: true,
      ...out,
      status: 'pending',
      message: 'Withdraw request submitted — pending approval',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
