const express = require('express');
const { z } = require('zod');
const { query } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { todayStrIST, nowMinutesIST } = require('../../utils/istTime');
const { declareSlot } = require('../../jobs/starlineResults');

const router = express.Router();

router.get('/slots', requireAuth, async (req, res, next) => {
  try {
    const today = todayStrIST();
    const nowM = nowMinutesIST();
    const slots = await query(
      `SELECT s.id, s.name, s.time_label AS timeLabel, s.close_minutes AS closeMinutes,
              s.sort_order AS sortOrder,
              r.open_digit AS openDigit, r.result_display AS result, r.declared_at AS declaredAt
       FROM starline_slots s
       LEFT JOIN starline_results r
         ON r.slot_id = s.id AND r.result_date = :today
       WHERE s.is_active = 1
       ORDER BY s.sort_order ASC`,
      { today }
    );

    const items = slots.map((s) => {
      const closeM = Number(s.closeMinutes);
      const hasResult = s.result != null && s.result !== '';
      let status = 'running';
      if (hasResult) status = 'result';
      else if (nowM >= closeM + 5) status = 'closed';
      else if (nowM >= closeM) status = 'closed';
      return {
        id: s.id,
        name: s.name,
        timeLabel: s.timeLabel,
        closeMinutes: closeM,
        status,
        result: s.result || null,
        openDigit: s.openDigit != null ? Number(s.openDigit) : null,
        declaredAt: s.declaredAt || null,
      };
    });

    res.json({ ok: true, items, date: today });
  } catch (err) {
    next(err);
  }
});

router.get('/results', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 120, 200);
    const rows = await query(
      `SELECT r.slot_id AS slotId, s.name, s.time_label AS timeLabel,
              DATE_FORMAT(r.result_date, '%Y-%m-%d') AS resultDate,
              r.open_digit AS openDigit,
              r.result_display AS result, r.declared_at AS declaredAt
       FROM starline_results r
       JOIN starline_slots s ON s.id = r.slot_id
       ORDER BY r.result_date DESC, s.sort_order DESC
       LIMIT ${limit}`
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    next(err);
  }
});

/** Admin: declare / override today's starline result → push all users */
router.post(
  '/declare',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          slotId: z.string().min(3).max(64),
          openDigit: z.number().int().min(0).max(9).optional(),
          resultDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .parse(req.body);

      const slots = await query(
        `SELECT id, name, close_minutes AS closeMinutes
         FROM starline_slots WHERE id = :id LIMIT 1`,
        { id: body.slotId }
      );
      if (!slots[0]) {
        return res.status(404).json({ ok: false, error: 'SLOT_NOT_FOUND' });
      }

      const today = body.resultDate || todayStrIST();
      const out = await declareSlot(slots[0], today, {
        openDigit: body.openDigit,
      });

      res.json({
        ok: true,
        slotId: slots[0].id,
        name: slots[0].name,
        resultDate: today,
        ...out,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
