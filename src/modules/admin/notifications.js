const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  getNotificationSettings,
  updateNotificationSettings,
} = require('../../services/notificationSettings');
const {
  sendAdminBroadcast,
  listHistory,
  deleteHistoryIds,
} = require('../../services/notificationService');
const { query } = require('../../config/db');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const settings = await getNotificationSettings();
    const history = await listHistory(120);
    res.json({ ok: true, settings, history });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/settings',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          result: z.boolean().optional(),
          call: z.boolean().optional(),
          message: z.boolean().optional(),
          bid: z.boolean().optional(),
          withdraw: z.boolean().optional(),
          deposit: z.boolean().optional(),
          win: z.boolean().optional(),
          starline: z.boolean().optional(),
          jackpot: z.boolean().optional(),
        })
        .parse(req.body);
      const settings = await updateNotificationSettings(body);
      res.json({ ok: true, settings, message: 'Notification settings updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/send',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          title: z.string().min(1).max(255),
          message: z.string().min(1).max(5000),
          userId: z.number().int().positive().optional(),
          target: z.enum(['user', 'all']).optional(),
        })
        .parse(req.body);

      const out = await sendAdminBroadcast({
        title: body.title,
        message: body.message,
        userId: body.target === 'all' || !body.userId ? null : body.userId,
      });

      res.json({
        ok: true,
        message:
          out.targetType === 'all'
            ? `Sent to ${out.recipientCount} users`
            : `Sent to ${out.targetLabel}`,
        ...out,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/search-user',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        return res.json({ ok: true, items: [] });
      }
      const rows = await query(
        `SELECT id, name, phone, login_id AS loginId, status
         FROM users
         WHERE role = 'player'
           AND (name LIKE CONCAT('%', :q, '%')
             OR phone LIKE CONCAT('%', :q, '%')
             OR login_id LIKE CONCAT('%', :q, '%'))
         ORDER BY id DESC
         LIMIT 12`,
        { q }
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/history',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({ ids: z.array(z.number().int().positive()).min(1).max(200) })
        .parse(req.body);
      const out = await deleteHistoryIds(body.ids);
      res.json({ ok: true, ...out, message: `${out.deleted} deleted` });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
