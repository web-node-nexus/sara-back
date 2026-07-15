const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');

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
      const providerId =
        req.user.role === 'admin' && req.query.providerId
          ? Number(req.query.providerId)
          : req.user.id;
      const rows = await query(
        `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status,
                w.balance AS walletBalance,
                COALESCE(b.bidCount, 0) AS bidCount,
                COALESCE(d.depositTotal, 0) AS depositTotal
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         LEFT JOIN (
           SELECT user_id, COUNT(*) AS bidCount FROM bids GROUP BY user_id
         ) b ON b.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(amount) AS depositTotal
           FROM wallet_ledger WHERE type = 'deposit' GROUP BY user_id
         ) d ON d.user_id = u.id
         WHERE u.role = 'player' AND u.provider_id = :providerId
         ORDER BY u.id DESC
         LIMIT ${limit}`,
        { providerId }
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
                w.balance AS walletBalance
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
      if (
        req.user.role === 'provider' &&
        Number(user.providerId) !== Number(req.user.id)
      ) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
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
      res.json({ ok: true, user, bids, txns });
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
      const rows = await query(
        `SELECT w.id, w.user_id AS userId, w.amount, w.status, w.note,
                w.created_at AS createdAt, u.name AS userName, u.phone
         FROM withdraw_requests w
         JOIN users u ON u.id = w.user_id
         WHERE w.status = 'pending'
         ORDER BY w.id ASC
         LIMIT 100`
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

      const out = await withTransaction(async (conn) => {
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
        if (body.decision === 'rejected') {
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
          return { status: 'rejected', balance };
        }
        await conn.execute(
          `UPDATE withdraw_requests SET status = 'approved' WHERE id = ?`,
          [id]
        );
        return { status: 'approved' };
      });

      res.json({ ok: true, ...out });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
