const express = require('express');
const { z } = require('zod');
const { query } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

const router = express.Router();

const STATUSES = [
  'not_called',
  'called',
  'not_attended',
  'interested',
  'not_interested',
  'deposited',
  'callback',
  'wrong_number',
  'switched_off',
];

const STATUS_SET = new Set(STATUSES);

const LABEL = {
  not_called: 'Not Called',
  called: 'Called',
  not_attended: 'Not Attended',
  interested: 'Interested',
  not_interested: 'Not Interested',
  deposited: 'Deposited',
  callback: 'Callback Req.',
  wrong_number: 'Wrong Number',
  switched_off: 'Switched Off',
};

function money(n) {
  return Number(n || 0);
}

function formatDate(d) {
  if (!d) return null;
  return d;
}

/** List deposit-call queue + summary stats */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all').trim();
    const depositFilter = String(req.query.deposit || 'all').trim(); // all | has | none
    const sort = String(req.query.sort || 'newest').trim(); // newest | oldest | deposit_high | deposit_low
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

    let orderBy = 'lastDepositAt DESC, u.id DESC';
    if (sort === 'oldest') orderBy = 'lastDepositAt ASC, u.id ASC';
    if (sort === 'deposit_high') orderBy = 'totalDeposit DESC, u.id DESC';
    if (sort === 'deposit_low') orderBy = 'totalDeposit ASC, u.id ASC';
    if (sort === 'newest') orderBy = 'COALESCE(dcs.updated_at, lastDepositAt, u.created_at) DESC, u.id DESC';

    const statusSql =
      status !== 'all' && STATUS_SET.has(status)
        ? `AND COALESCE(dcs.status, 'not_called') = :status`
        : '';

    let depositSql = '';
    if (depositFilter === 'has') depositSql = 'AND COALESCE(dep.totalDeposit, 0) > 0';
    if (depositFilter === 'none') depositSql = 'AND COALESCE(dep.totalDeposit, 0) = 0';

    const rows = await query(
      `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status AS userStatus,
              COALESCE(dep.totalDeposit, 0) AS totalDeposit,
              COALESCE(dep.lastDeposit, 0) AS lastDeposit,
              dep.lastDepositAt AS lastDepositAt,
              COALESCE(dcs.status, 'not_called') AS callStatus,
              dcs.remark AS remark,
              COALESCE(dcs.call_count, 0) AS callCount,
              dcs.last_called_at AS lastCalledAt,
              dcs.updated_at AS statusUpdatedAt,
              agent.name AS lastAgentName
       FROM users u
       LEFT JOIN (
         SELECT user_id,
                SUM(amount) AS totalDeposit,
                SUBSTRING_INDEX(GROUP_CONCAT(amount ORDER BY created_at DESC), ',', 1) AS lastDeposit,
                MAX(created_at) AS lastDepositAt
         FROM wallet_ledger
         WHERE type = 'deposit'
         GROUP BY user_id
       ) dep ON dep.user_id = u.id
       LEFT JOIN deposit_call_status dcs ON dcs.user_id = u.id
       LEFT JOIN users agent ON agent.id = dcs.last_called_by
       WHERE u.role = 'player'
         AND (
           :q = ''
           OR u.phone LIKE CONCAT('%', :q, '%')
           OR u.login_id LIKE CONCAT('%', :q, '%')
           OR u.name LIKE CONCAT('%', :q, '%')
         )
         ${statusSql}
         ${depositSql}
       ORDER BY ${orderBy}
       LIMIT ${limit}`,
      { q, status: STATUS_SET.has(status) ? status : 'not_called' }
    );

    const [stats] = await query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(dcs.status, 'not_called') = 'called' THEN 1 ELSE 0 END) AS called,
         SUM(CASE WHEN COALESCE(dcs.status, 'not_called') = 'deposited' THEN 1 ELSE 0 END) AS deposited,
         SUM(CASE WHEN COALESCE(dcs.status, 'not_called') = 'interested' THEN 1 ELSE 0 END) AS interested
       FROM users u
       LEFT JOIN deposit_call_status dcs ON dcs.user_id = u.id
       WHERE u.role = 'player'`
    );

    const items = rows.map((r, i) => ({
      sn: i + 1,
      id: r.id,
      name: r.name || '',
      phone: r.phone || r.loginId || '',
      totalDeposit: money(r.totalDeposit),
      lastDeposit: money(r.lastDeposit),
      lastDepositAt: formatDate(r.lastDepositAt),
      callStatus: r.callStatus,
      callStatusLabel: LABEL[r.callStatus] || r.callStatus,
      remark: r.remark || '',
      callCount: Number(r.callCount || 0),
      lastCalledAt: formatDate(r.lastCalledAt),
      lastAgentName: r.lastAgentName || null,
      statusUpdatedAt: formatDate(r.statusUpdatedAt),
    }));

    res.json({
      ok: true,
      items,
      totalShown: items.length,
      stats: {
        total: Number(stats?.total || 0),
        called: Number(stats?.called || 0),
        deposited: Number(stats?.deposited || 0),
        interested: Number(stats?.interested || 0),
      },
      statuses: STATUSES.map((s) => ({ key: s, label: LABEL[s] })),
    });
  } catch (err) {
    next(err);
  }
});

/** Update call status (+ optional remark) */
router.patch(
  '/:userId',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const userId = Number(req.params.userId);
      const body = z
        .object({
          status: z.enum(STATUSES),
          remark: z.string().max(500).optional().nullable(),
        })
        .parse(req.body);

      const users = await query(
        `SELECT id, name, phone FROM users WHERE id = :id AND role = 'player' LIMIT 1`,
        { id: userId }
      );
      if (!users[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      const agentId = req.user.id;
      const agentRows = await query(
        `SELECT name FROM users WHERE id = :id LIMIT 1`,
        { id: agentId }
      );
      const agentName = agentRows[0]?.name || 'Admin';

      const bumpCall = [
        'called',
        'not_attended',
        'interested',
        'not_interested',
        'deposited',
        'callback',
        'wrong_number',
        'switched_off',
      ].includes(body.status)
        ? 1
        : 0;

      await query(
        `INSERT INTO deposit_call_status
           (user_id, status, remark, call_count, last_called_at, last_called_by)
         VALUES
           (:userId, :status, :remark, :bump, IF(:bump = 1, NOW(), NULL), IF(:bump = 1, :agentId, NULL))
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           remark = VALUES(remark),
           call_count = call_count + VALUES(call_count),
           last_called_at = IF(VALUES(call_count) = 1, NOW(), last_called_at),
           last_called_by = IF(VALUES(call_count) = 1, :agentId, last_called_by)`,
        {
          userId,
          status: body.status,
          remark: body.remark || null,
          bump: bumpCall,
          agentId,
        }
      );

      await query(
        `INSERT INTO deposit_call_history
           (user_id, status, remark, agent_id, agent_name)
         VALUES (:userId, :status, :remark, :agentId, :agentName)`,
        {
          userId,
          status: body.status,
          remark: body.remark || null,
          agentId,
          agentName,
        }
      );

      const [row] = await query(
        `SELECT COALESCE(dcs.status, 'not_called') AS callStatus,
                dcs.remark, COALESCE(dcs.call_count, 0) AS callCount,
                dcs.last_called_at AS lastCalledAt,
                agent.name AS lastAgentName
         FROM deposit_call_status dcs
         LEFT JOIN users agent ON agent.id = dcs.last_called_by
         WHERE dcs.user_id = :userId
         LIMIT 1`,
        { userId }
      );

      res.json({
        ok: true,
        item: {
          id: userId,
          callStatus: row.callStatus,
          callStatusLabel: LABEL[row.callStatus] || row.callStatus,
          remark: row.remark || '',
          callCount: Number(row.callCount || 0),
          lastCalledAt: row.lastCalledAt,
          lastAgentName: row.lastAgentName || agentName,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Reset status to Not Called */
router.post(
  '/:userId/reset',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const userId = Number(req.params.userId);
      const agentId = req.user.id;
      const agentRows = await query(
        `SELECT name FROM users WHERE id = :id LIMIT 1`,
        { id: agentId }
      );
      const agentName = agentRows[0]?.name || 'Admin';

      await query(
        `INSERT INTO deposit_call_status (user_id, status, remark, call_count)
         VALUES (:userId, 'not_called', NULL, 0)
         ON DUPLICATE KEY UPDATE
           status = 'not_called',
           remark = NULL`,
        { userId }
      );

      await query(
        `INSERT INTO deposit_call_history
           (user_id, status, remark, agent_id, agent_name)
         VALUES (:userId, 'not_called', 'Reset by agent', :agentId, :agentName)`,
        { userId, agentId, agentName }
      );

      res.json({
        ok: true,
        item: {
          id: userId,
          callStatus: 'not_called',
          callStatusLabel: LABEL.not_called,
          remark: '',
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Call history for one user */
router.get(
  '/:userId/history',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const userId = Number(req.params.userId);
      const rows = await query(
        `SELECT id, status, remark, agent_id AS agentId, agent_name AS agentName,
                created_at AS createdAt
         FROM deposit_call_history
         WHERE user_id = :userId
         ORDER BY id DESC
         LIMIT 100`,
        { userId }
      );
      res.json({
        ok: true,
        items: rows.map((r) => ({
          ...r,
          statusLabel: LABEL[r.status] || r.status,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
