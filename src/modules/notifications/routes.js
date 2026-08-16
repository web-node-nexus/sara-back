const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnread,
} = require('../../services/notificationService');

const router = express.Router();

router.get('/mine', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const [items, unread] = await Promise.all([
      listUserNotifications(req.user.id, limit),
      countUnread(req.user.id),
    ]);
    res.json({ ok: true, items, unread });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id/read',
  requireAuth,
  requireRole('player'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await markNotificationRead(req.user.id, id);
      const unread = await countUnread(req.user.id);
      res.json({ ok: true, unread });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/read-all',
  requireAuth,
  requireRole('player'),
  async (req, res, next) => {
    try {
      await markAllNotificationsRead(req.user.id);
      res.json({ ok: true, unread: 0 });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
