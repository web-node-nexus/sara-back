const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  updateFlash,
  updateMarquee,
  createBoardItem,
  updateBoardItem,
  deleteBoardItem,
  getAdminNotices,
} = require('../../services/noticeService');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const data = await getAdminNotices();
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/flash',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          title: z.string().max(255),
          message: z.string().max(5000),
          enabled: z.boolean(),
        })
        .parse(req.body);
      const settings = await updateFlash(body);
      res.json({ ok: true, settings, message: 'Popup updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/marquee',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          title: z.string().max(255),
          description: z.string().max(5000),
        })
        .parse(req.body);
      const settings = await updateMarquee(body);
      res.json({ ok: true, settings, message: 'Marquee updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/board',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          title: z.string().min(1).max(255),
          content: z.string().min(1).max(10000),
          sortOrder: z.number().int().optional(),
        })
        .parse(req.body);
      const item = await createBoardItem(body);
      res.status(201).json({ ok: true, item, message: 'Notice added' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/board/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          title: z.string().min(1).max(255).optional(),
          content: z.string().min(1).max(10000).optional(),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional(),
        })
        .parse(req.body);
      const item = await updateBoardItem(id, body);
      res.json({ ok: true, item, message: 'Notice updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/board/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const out = await deleteBoardItem(id);
      res.json({ ok: true, ...out, message: 'Notice deleted' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
