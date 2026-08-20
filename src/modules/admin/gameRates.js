const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { listRates, updateRate } = require('../../services/gameRates');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const kind = String(req.query.kind || '').toLowerCase();
    const valid = ['main', 'starline', 'jackpot'].includes(kind) ? kind : '';
    const items = await listRates(valid || undefined);
    res.json({ ok: true, kind: valid || 'all', items });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          heading: z.string().min(1).max(80).optional(),
          gameName: z.string().min(1).max(120).optional(),
          amount: z.number().positive().max(1000000).optional(),
          rate: z.number().min(0).max(10000000).optional(),
        })
        .parse(req.body);

      const item = await updateRate(id, body);
      res.json({ ok: true, item, message: 'Game rate updated' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
