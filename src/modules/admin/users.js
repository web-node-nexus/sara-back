const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { notifyAdminActivity, sendAdminActivityPush } = require('../../services/pushNotifications');

const router = express.Router();

function rupee(n) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function inactiveLabel(fromDate) {
  if (!fromDate) return '—';
  const ms = Date.now() - new Date(fromDate).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} hrs`;
  const days = Math.floor(hrs / 24);
  if (days < 60) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''}`;
}

function formatMoney(n) {
  return Number(n || 0);
}

/** Admin player list — search, sort, limit, page + dashboard summary */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const sort = String(req.query.sort || 'oldest');

    let orderBy = 'u.id ASC';
    switch (sort) {
      case 'newest':
        orderBy = 'u.id DESC';
        break;
      case 'oldest':
        orderBy = 'u.id ASC';
        break;
      case 'active':
        orderBy = `CASE u.status WHEN 'active' THEN 0 ELSE 1 END, u.id DESC`;
        break;
      case 'deactive':
        orderBy = `CASE u.status WHEN 'blocked' THEN 0 ELSE 1 END, u.id DESC`;
        break;
      case 'high_point':
        orderBy = 'COALESCE(w.balance, 0) DESC, u.id DESC';
        break;
      default:
        orderBy = 'u.id ASC';
    }

    const whereSql = `u.role = 'player'
         AND (
           :q = ''
           OR u.name LIKE CONCAT('%', :q, '%')
           OR u.phone LIKE CONCAT('%', :q, '%')
           OR u.login_id LIKE CONCAT('%', :q, '%')
         )`;

    const [countRow] = await query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${whereSql}`,
      { q }
    );
    const totalRecords = Number(countRow?.total || 0);
    const totalPages = Math.max(Math.ceil(totalRecords / limit), 1);
    const safePage = Math.min(page, totalPages);

    const [summaryRow] = await query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'player') AS totalUsers,
         (SELECT COALESCE(SUM(w.balance), 0)
            FROM wallets w
            INNER JOIN users u ON u.id = w.user_id AND u.role = 'player'
         ) AS totalWallet,
         (SELECT COALESCE(SUM(amount), 0)
            FROM wallet_ledger WHERE type = 'deposit') AS totalRecharge,
         (SELECT COALESCE(SUM(amount), 0)
            FROM wallet_ledger WHERE type = 'withdraw') AS totalWithdrawal`
    );

    const rows = await query(
      `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status,
              u.created_at AS createdAt,
              u.last_seen_at AS lastSeenAt,
              COALESCE(w.balance, 0) AS points,
              (
                SELECT MAX(x.ts) FROM (
                  SELECT MAX(b.created_at) AS ts FROM bids b WHERE b.user_id = u.id
                  UNION ALL
                  SELECT MAX(l.created_at) FROM wallet_ledger l WHERE l.user_id = u.id
                  UNION ALL
                  SELECT u.last_seen_at
                  UNION ALL
                  SELECT u.created_at
                ) x
              ) AS lastActiveAt
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${(safePage - 1) * limit}`,
      { q }
    );

    const snBase = (safePage - 1) * limit;
    const items = rows.map((r, i) => ({
      sn: snBase + i + 1,
      id: r.id,
      name: r.name,
      phone: r.phone || '',
      loginId: r.loginId,
      status: r.status,
      points: formatMoney(r.points),
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt || r.createdAt,
      inactiveLabel: inactiveLabel(r.lastActiveAt || r.createdAt),
    }));

    res.json({
      ok: true,
      items,
      total: totalRecords,
      page: safePage,
      pageSize: limit,
      totalPages,
      summary: {
        totalUsers: Number(summaryRow?.totalUsers || 0),
        totalWallet: formatMoney(summaryRow?.totalWallet),
        totalRecharge: formatMoney(summaryRow?.totalRecharge),
        totalWithdrawal: formatMoney(summaryRow?.totalWithdrawal),
        totalRecords,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Create player account */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(2).max(120),
        phone: z.string().min(10).max(15),
        password: z.string().min(4).max(72),
      })
      .parse(req.body);

    const phone = body.phone.replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_PHONE',
        message: 'Enter 10-digit mobile number',
      });
    }

    const loginId = phone;
    const hash = await bcrypt.hash(body.password, 10);
    const name = body.name.trim();

    const result = await query(
      `INSERT INTO users (login_id, phone, password_hash, name, role, status)
       VALUES (:loginId, :phone, :hash, :name, 'player', 'active')`,
      { loginId, phone, hash, name }
    );
    await query(`INSERT INTO wallets (user_id, balance) VALUES (:id, 0)`, {
      id: result.insertId,
    });

    res.status(201).json({
      ok: true,
      user: {
        id: result.insertId,
        name,
        phone,
        loginId,
        status: 'active',
        points: 0,
      },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      err.status = 409;
      err.code = 'PHONE_TAKEN';
      err.message = 'Mobile number already registered';
    }
    next(err);
  }
});

/** User profile detail */
router.get(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const users = await query(
        `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status,
                u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
                COALESCE(w.balance, 0) AS balance
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

      const [bidAgg] = await query(
        `SELECT COALESCE(SUM(points), 0) AS totalBids,
                COUNT(*) AS bidCount
         FROM bids WHERE user_id = :id`,
        { id }
      );
      const [winAgg] = await query(
        `SELECT COALESCE(SUM(amount), 0) AS totalWins
         FROM wallet_ledger WHERE user_id = :id AND type = 'win'`,
        { id }
      );
      const [depAgg] = await query(
        `SELECT COALESCE(SUM(amount), 0) AS totalDeposit
         FROM wallet_ledger WHERE user_id = :id AND type = 'deposit'`,
        { id }
      );
      const [wdAgg] = await query(
        `SELECT COALESCE(SUM(amount), 0) AS totalWithdraw
         FROM wallet_ledger WHERE user_id = :id AND type = 'withdraw'`,
        { id }
      );

      const lastActiveRows = await query(
        `SELECT MAX(ts) AS lastActiveAt FROM (
           SELECT MAX(created_at) AS ts FROM bids WHERE user_id = :id
           UNION ALL
           SELECT MAX(created_at) FROM wallet_ledger WHERE user_id = :id
           UNION ALL
           SELECT :createdAt
           UNION ALL
           SELECT :lastSeen
         ) t`,
        {
          id,
          createdAt: user.createdAt,
          lastSeen: user.lastSeenAt,
        }
      );

      const payments = await query(
        `SELECT id, type, label, bank_name AS bankName, account_name AS accountName,
                account_number AS accountNumber, ifsc, upi_id AS upiId, created_at AS createdAt
         FROM user_payment_methods
         WHERE user_id = :id
         ORDER BY id DESC`,
        { id }
      );

      // Fallback: distinct bank/upi from past withdraw requests
      let paymentFallback = { bank: [], upi: [] };
      if (!payments.length) {
        const wr = await query(
          `SELECT account_name AS accountName, account_number AS accountNumber,
                  ifsc, bank_name AS bankName, upi_id AS upiId
           FROM withdraw_requests
           WHERE user_id = :id
           ORDER BY id DESC LIMIT 20`,
          { id }
        );
        const seenBank = new Set();
        const seenUpi = new Set();
        for (const r of wr) {
          if (r.accountNumber && r.ifsc) {
            const key = `${r.accountNumber}:${r.ifsc}`;
            if (seenBank.has(key)) continue;
            seenBank.add(key);
            paymentFallback.bank.push({
              id: `wr-bank-${r.accountNumber}`,
              type: 'bank',
              bankName: r.bankName || 'Bank',
              accountName: r.accountName,
              accountNumber: r.accountNumber,
              ifsc: r.ifsc,
              fromWithdraw: true,
            });
          }
          if (r.upiId) {
            if (seenUpi.has(r.upiId)) continue;
            seenUpi.add(r.upiId);
            paymentFallback.upi.push({
              id: `wr-upi-${r.upiId}`,
              type: 'upi',
              upiId: r.upiId,
              fromWithdraw: true,
            });
          }
        }
      }

      const bids = await query(
        `SELECT id, market_name AS marketName, game_name AS gameName, number_value AS number,
                points, status, session, created_at AS createdAt
         FROM bids WHERE user_id = :id ORDER BY id DESC LIMIT 80`,
        { id }
      );
      const wins = await query(
        `SELECT id, amount, note, balance_after AS balanceAfter, created_at AS createdAt
         FROM wallet_ledger WHERE user_id = :id AND type = 'win'
         ORDER BY id DESC LIMIT 50`,
        { id }
      );
      const deposits = await query(
        `SELECT id, amount, note, balance_after AS balanceAfter, created_at AS createdAt
         FROM wallet_ledger WHERE user_id = :id AND type = 'deposit'
         ORDER BY id DESC LIMIT 50`,
        { id }
      );

      const lastActiveAt =
        lastActiveRows[0]?.lastActiveAt || user.createdAt;

      res.json({
        ok: true,
        user: {
          ...user,
          balance: formatMoney(user.balance),
          lastActiveAt,
          inactiveLabel: inactiveLabel(lastActiveAt),
        },
        stats: {
          totalBids: formatMoney(bidAgg?.totalBids),
          bidCount: Number(bidAgg?.bidCount || 0),
          totalWins: formatMoney(winAgg?.totalWins),
          totalWithdraw: formatMoney(wdAgg?.totalWithdraw),
          totalDeposit: formatMoney(depAgg?.totalDeposit),
        },
        payments: payments.length
          ? payments
          : [...paymentFallback.bank, ...paymentFallback.upi],
        bids,
        wins,
        deposits,
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Update name / status / password */
router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          name: z.string().min(2).max(120).optional(),
          status: z.enum(['active', 'blocked']).optional(),
          password: z.string().min(4).max(72).optional(),
        })
        .parse(req.body);

      const users = await query(
        `SELECT id FROM users WHERE id = :id AND role = 'player' LIMIT 1`,
        { id }
      );
      if (!users[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      let passwordHash = null;
      if (body.password) {
        passwordHash = await bcrypt.hash(body.password, 10);
      }

      await query(
        `UPDATE users SET
           name = COALESCE(:name, name),
           status = COALESCE(:status, status),
           password_hash = COALESCE(:hash, password_hash)
         WHERE id = :id`,
        {
          id,
          name: body.name != null ? body.name.trim() : null,
          status: body.status || null,
          hash: passwordHash,
        }
      );

      if (body.password) {
        notifyAdminActivity(id, {
          title: 'Password updated',
          body: 'Admin ne aapka password change kar diya hai.',
          activity: 'password_changed',
        });
      }
      if (body.name != null) {
        notifyAdminActivity(id, {
          title: 'Username updated',
          body: `Aapka naya username: ${body.name.trim()}`,
          activity: 'username_changed',
          extra: { name: body.name.trim() },
        });
      }
      if (body.status === 'blocked') {
        notifyAdminActivity(id, {
          title: 'Account deactivated',
          body: 'Admin ne aapka account block / deactivate kar diya hai.',
          activity: 'account_blocked',
        });
      } else if (body.status === 'active') {
        notifyAdminActivity(id, {
          title: 'Account activated',
          body: 'Aapka account phir se active kar diya gaya hai.',
          activity: 'account_activated',
        });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

/** Adjust wallet balance (+ / -) */
router.post(
  '/:id/adjust-balance',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          amount: z.number().positive().max(500000),
          direction: z.enum(['credit', 'debit']),
          note: z.string().max(255).optional(),
        })
        .parse(req.body);

      const out = await withTransaction(async (conn) => {
        const [users] = await conn.execute(
          `SELECT id FROM users WHERE id = ? AND role = 'player' LIMIT 1`,
          [id]
        );
        if (!users[0]) {
          const err = new Error('User not found');
          err.status = 404;
          throw err;
        }
        const [wallets] = await conn.execute(
          `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
          [id]
        );
        if (!wallets[0]) {
          await conn.execute(
            `INSERT INTO wallets (user_id, balance) VALUES (?, 0)`,
            [id]
          );
        }
        const [again] = await conn.execute(
          `SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE`,
          [id]
        );
        let balance = Number(again[0].balance);
        const amt = Number(body.amount);
        if (body.direction === 'credit') balance += amt;
        else {
          if (balance < amt) {
            const err = new Error('Insufficient balance');
            err.status = 400;
            throw err;
          }
          balance -= amt;
        }
        await conn.execute(
          `UPDATE wallets SET balance = ?, version = version + 1 WHERE user_id = ?`,
          [balance, id]
        );
        await conn.execute(
          `INSERT INTO wallet_ledger
            (user_id, type, amount, balance_after, note, ref_type)
           VALUES (?, 'adjust', ?, ?, ?, 'admin_adjust')`,
          [
            id,
            body.direction === 'credit' ? amt : -amt,
            balance,
            body.note ||
              `Admin ${body.direction} ₹${amt}`,
          ]
        );
        return { balance };
      });

      await cache.del(`wallet:${id}`);

      const amt = Number(body.amount);
      if (body.direction === 'credit') {
        notifyAdminActivity(id, {
          title: 'Amount added',
          body: `Admin ne aapke account me ${rupee(amt)} add kiye. New balance: ${rupee(out.balance)}`,
          activity: 'balance_credit',
          extra: { amount: amt, balance: out.balance, direction: 'credit' },
        });
      } else {
        notifyAdminActivity(id, {
          title: 'Amount deducted',
          body: `Admin ne aapke account se ${rupee(amt)} deduct kiye. New balance: ${rupee(out.balance)}`,
          activity: 'balance_debit',
          extra: { amount: amt, balance: out.balance, direction: 'debit' },
        });
      }

      res.json({ ok: true, balance: out.balance });
    } catch (err) {
      next(err);
    }
  }
);

/** Soft-delete / block player */
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const hard = String(req.query.hard || '') === '1';
      const users = await query(
        `SELECT id FROM users WHERE id = :id AND role = 'player' LIMIT 1`,
        { id }
      );
      if (!users[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (hard) {
        await sendAdminActivityPush({
          recipientUserId: id,
          title: 'Account removed',
          body: 'Admin ne aapka account delete kar diya hai.',
          activity: 'account_deleted',
        }).catch(() => undefined);
        await query(`DELETE FROM users WHERE id = :id`, { id });
      } else {
        await query(
          `UPDATE users SET status = 'blocked' WHERE id = :id`,
          { id }
        );
        notifyAdminActivity(id, {
          title: 'Account deactivated',
          body: 'Admin ne aapka account deactivate kar diya hai.',
          activity: 'account_blocked',
        });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

/** Add payment method */
router.post(
  '/:id/payments',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
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
      } else if (!body.upiId) {
        return res.status(400).json({
          ok: false,
          error: 'UPI_REQUIRED',
          message: 'UPI ID required',
        });
      }

      const result = await query(
        `INSERT INTO user_payment_methods
          (user_id, type, label, bank_name, account_name, account_number, ifsc, upi_id)
         VALUES
          (:userId, :type, :label, :bankName, :accountName, :accountNumber, :ifsc, :upiId)`,
        {
          userId: id,
          type: body.type,
          label: body.label || body.bankName || body.upiId || null,
          bankName: body.bankName || null,
          accountName: body.accountName || null,
          accountNumber: body.accountNumber || null,
          ifsc: body.ifsc ? body.ifsc.toUpperCase() : null,
          upiId: body.upiId || null,
        }
      );

      notifyAdminActivity(id, {
        title: 'Payment details added',
        body:
          body.type === 'bank'
            ? `Admin ne bank details add kiye (${body.bankName || 'Bank'}).`
            : `Admin ne UPI add kiya (${body.upiId}).`,
        activity: 'payment_added',
        extra: { paymentType: body.type },
      });

      res.status(201).json({ ok: true, id: result.insertId });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id/payments/:paymentId',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const uid = Number(req.params.id);
      await query(
        `DELETE FROM user_payment_methods
         WHERE id = :pid AND user_id = :uid`,
        { pid: Number(req.params.paymentId), uid }
      );
      notifyAdminActivity(uid, {
        title: 'Payment details removed',
        body: 'Admin ne aapke payment details hata diye hain.',
        activity: 'payment_removed',
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
