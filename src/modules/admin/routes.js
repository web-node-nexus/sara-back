const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { notifySystemEventAsync } = require('../../services/notificationService');
const { createPayout } = require('../payments/imb');
const { config } = require('../../config/env');

const router = express.Router();

router.get(
  '/providers',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT id, name, login_id AS loginId, phone AS mobile, status,
                created_at AS createdAt,
                CASE WHEN status = 'active' THEN 1 ELSE 0 END AS active
         FROM users
         WHERE role = 'provider'
         ORDER BY id DESC
         LIMIT 200`
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/providers',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          name: z.string().min(1).max(120),
          loginId: z.string().min(3).max(64),
          password: z.string().min(4).max(72),
          mobile: z.string().min(8).max(20).optional(),
        })
        .parse(req.body);
      const loginId = body.loginId.trim().toLowerCase();
      const hash = await bcrypt.hash(body.password, 10);
      const result = await query(
        `INSERT INTO users (login_id, phone, password_hash, name, role, status)
         VALUES (:loginId, :phone, :hash, :name, 'provider', 'active')`,
        {
          loginId,
          phone: body.mobile || null,
          hash,
          name: body.name.trim(),
        }
      );
      await query(`INSERT INTO wallets (user_id, balance) VALUES (:id, 0)`, {
        id: result.insertId,
      });
      res.status(201).json({
        ok: true,
        provider: {
          id: result.insertId,
          name: body.name.trim(),
          loginId,
          mobile: body.mobile || '',
          active: true,
        },
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        err.status = 409;
        err.code = 'LOGIN_TAKEN';
      }
      next(err);
    }
  }
);

router.patch(
  '/providers/:id/toggle',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await query(
        `UPDATE users
         SET status = IF(status = 'active', 'blocked', 'active')
         WHERE id = :id AND role = 'provider'`,
        { id }
      );
      const rows = await query(
        `SELECT id, status FROM users WHERE id = :id AND role = 'provider' LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      res.json({
        ok: true,
        id,
        active: rows[0].status === 'active',
        status: rows[0].status,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/users',
  requireAuth,
  requireRole('provider', 'admin'),
  async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const isAdmin = req.user.role === 'admin';
      const providerId =
        isAdmin && req.query.providerId
          ? Number(req.query.providerId)
          : req.user.id;

      // Shared inbox: assigned players OR anyone with a support thread
      const rows = await query(
        `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status,
                u.provider_id AS providerId,
                w.balance AS walletBalance,
                COALESCE(b.bidCount, 0) AS bidCount,
                COALESCE(d.depositTotal, 0) AS depositTotal,
                (
                  SELECT t.id FROM chat_threads t
                  WHERE t.user_id = u.id
                  ORDER BY t.updated_at DESC LIMIT 1
                ) AS threadId
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         LEFT JOIN (
           SELECT user_id, COUNT(*) AS bidCount FROM bids GROUP BY user_id
         ) b ON b.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(amount) AS depositTotal
           FROM wallet_ledger WHERE type = 'deposit' GROUP BY user_id
         ) d ON d.user_id = u.id
         WHERE u.role = 'player'
           AND (
             :isAdmin = 1
             OR u.provider_id = :providerId
             OR EXISTS (
               SELECT 1 FROM chat_threads t WHERE t.user_id = u.id
             )
           )
         ORDER BY u.id DESC
         LIMIT ${limit}`,
        { providerId, isAdmin: isAdmin ? 1 : 0 }
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/users/:id',
  requireAuth,
  requireRole('provider', 'admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const users = await query(
        `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status, u.provider_id AS providerId,
                w.balance AS walletBalance,
                (
                  SELECT t.id FROM chat_threads t
                  WHERE t.user_id = u.id
                  ORDER BY t.updated_at DESC LIMIT 1
                ) AS threadId
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         WHERE u.id = :id AND u.role = 'player'
         LIMIT 1`,
        { id }
      );
      const user = users[0];
      if (!user) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (req.user.role === 'provider') {
        const assigned = Number(user.providerId) === Number(req.user.id);
        const hasThread = !!user.threadId;
        if (!assigned && !hasThread) {
          return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
        }
      }
      const bids = await query(
        `SELECT id, market_name AS marketName, game_name AS gameName, number_value AS number,
                points, status, created_at AS createdAt
         FROM bids WHERE user_id = :id ORDER BY id DESC LIMIT 50`,
        { id }
      );
      const txns = await query(
        `SELECT id, type, amount, balance_after AS balanceAfter, note, created_at AS createdAt
         FROM wallet_ledger WHERE user_id = :id ORDER BY id DESC LIMIT 50`,
        { id }
      );
      const depositTotal = txns
        .filter((t) => t.type === 'deposit')
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      res.json({
        ok: true,
        user,
        bids,
        txns,
        stats: {
          bidCount: bids.length,
          depositTotal,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/users/:id/assign',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const providerId = Number(req.body.providerId);
      await query(
        `UPDATE users SET provider_id = :providerId WHERE id = :id AND role = 'player'`,
        { id, providerId }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/withdraws',
  requireAuth,
  requireRole('admin', 'provider'),
  async (req, res, next) => {
    try {
      const status = String(req.query.status || 'pending');
      const statuses =
        status === 'all'
          ? ['pending', 'processing', 'approved', 'paid', 'rejected']
          : status === 'open'
            ? ['pending', 'processing']
            : [status];
      const named = {};
      const keys = statuses.map((s, i) => {
        const k = `s${i}`;
        named[k] = s;
        return `:${k}`;
      });
      const rows = await query(
        `SELECT w.id, w.user_id AS userId, w.amount, w.status, w.note,
                w.upi_id AS upiId, w.account_name AS accountName,
                w.account_number AS accountNumber, w.ifsc, w.bank_name AS bankName,
                w.client_ref_id AS clientRefId, w.payout_txn_id AS payoutTxnId,
                w.payout_status AS payoutStatus,
                w.created_at AS createdAt, u.name AS userName, u.phone
         FROM withdraw_requests w
         JOIN users u ON u.id = w.user_id
         WHERE w.status IN (${keys.join(',')})
         ORDER BY w.id DESC
         LIMIT 100`,
        named
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/withdraws/:id/decide',
  requireAuth,
  requireRole('admin', 'provider'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({ decision: z.enum(['approved', 'rejected']) })
        .parse(req.body);

      if (body.decision === 'rejected') {
        const out = await withTransaction(async (conn) => {
          const [rows] = await conn.execute(
            `SELECT * FROM withdraw_requests WHERE id = ? FOR UPDATE`,
            [id]
          );
          const wr = rows[0];
          if (!wr || !['pending', 'processing'].includes(wr.status)) {
            const err = new Error('Not found or already decided');
            err.status = 404;
            throw err;
          }
          if (wr.status === 'processing') {
            const err = new Error('Payout already in progress');
            err.status = 409;
            err.code = 'PAYOUT_IN_PROGRESS';
            throw err;
          }
          const [wallets] = await conn.execute(
            `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
            [wr.user_id]
          );
          const balance = Number(wallets[0].balance) + Number(wr.amount);
          await conn.execute(
            `UPDATE wallets SET balance = ?, version = version + 1 WHERE user_id = ?`,
            [balance, wr.user_id]
          );
          await conn.execute(
            `INSERT INTO wallet_ledger
              (user_id, type, amount, balance_after, note, ref_type, ref_id)
             VALUES (?, 'adjust', ?, ?, 'Withdraw rejected — refund', 'withdraw_request', ?)`,
            [wr.user_id, wr.amount, balance, String(id)]
          );
          await conn.execute(
            `UPDATE withdraw_requests SET status = 'rejected' WHERE id = ?`,
            [id]
          );
          await cache.del(`wallet:${wr.user_id}`);
          return {
            status: 'rejected',
            balance,
            userId: wr.user_id,
            amount: wr.amount,
          };
        });
        const users = await query(
          `SELECT name FROM users WHERE id = :id LIMIT 1`,
          { id: out.userId }
        );
        const userName = users[0]?.name || 'User';
        notifySystemEventAsync({
          userId: out.userId,
          kind: 'withdraw',
          title: 'Withdrawal Rejected',
          message: `Dear ${userName}, Your withdrawal request of Rs.${Number(out.amount).toLocaleString('en-IN')} has been rejected. Amount refunded to wallet.`,
        });
        return res.json({ ok: true, status: out.status, balance: out.balance });
      }

      // Approve → initiate IMB payout
      const locked = await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
          `SELECT * FROM withdraw_requests WHERE id = ? FOR UPDATE`,
          [id]
        );
        const wr = rows[0];
        if (!wr || wr.status !== 'pending') {
          const err = new Error('Not found or already decided');
          err.status = 404;
          throw err;
        }
        const clientRef = `WD${id}_${Date.now()}`;
        await conn.execute(
          `UPDATE withdraw_requests
           SET status = 'processing', client_ref_id = ?, payout_status = 'Initiated'
           WHERE id = ?`,
          [clientRef, id]
        );
        return { ...wr, client_ref_id: clientRef };
      });

      try {
        const payout = await createPayout({
          amount: locked.amount,
          clientRef: locked.client_ref_id,
          accountNumber: locked.account_number,
          ifsc: locked.ifsc,
          accountName:
            locked.account_name ||
            locked.upi_id ||
            `user-${locked.user_id}`,
          bankName: locked.bank_name,
          upiId: locked.upi_id,
          tag: `SARA567 WD${id}`,
        });

        const finalStatus =
          config.imb.mock || Number(payout.responseCode) === 112
            ? 'paid'
            : 'processing';

        await query(
          `UPDATE withdraw_requests
           SET status = :status,
               payout_txn_id = :txn,
               payout_status = :pst
           WHERE id = :id`,
          {
            status: finalStatus,
            txn: payout.txnId,
            pst: payout.status || 'Initiated',
            id,
          }
        );

        res.json({
          ok: true,
          status: finalStatus,
          payoutTxnId: payout.txnId,
          clientRefId: locked.client_ref_id,
        });
      } catch (payoutErr) {
        await withTransaction(async (conn) => {
          const [rows] = await conn.execute(
            `SELECT * FROM withdraw_requests WHERE id = ? FOR UPDATE`,
            [id]
          );
          const wr = rows[0];
          if (!wr || wr.status === 'paid' || wr.status === 'rejected') return;
          const [wallets] = await conn.execute(
            `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
            [wr.user_id]
          );
          const balance = Number(wallets[0].balance) + Number(wr.amount);
          await conn.execute(
            `UPDATE wallets SET balance = ?, version = version + 1 WHERE user_id = ?`,
            [balance, wr.user_id]
          );
          await conn.execute(
            `INSERT INTO wallet_ledger
              (user_id, type, amount, balance_after, note, ref_type, ref_id)
             VALUES (?, 'adjust', ?, ?, 'Withdraw payout failed — refund', 'withdraw_request', ?)`,
            [wr.user_id, wr.amount, balance, String(id)]
          );
          await conn.execute(
            `UPDATE withdraw_requests
             SET status = 'rejected', payout_status = ?
             WHERE id = ?`,
            [payoutErr.message || 'Fail', id]
          );
          await cache.del(`wallet:${wr.user_id}`);
        });
        const err = new Error(payoutErr.message || 'Payout failed');
        err.status = 502;
        err.code = 'IMB_PAYOUT_FAILED';
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
