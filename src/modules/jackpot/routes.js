const express = require('express');
const { query } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const { todayStrIST, nowMinutesIST } = require('../../utils/istTime');

const router = express.Router();

router.get('/slots', requireAuth, async (req, res, next) => {
  try {
    const today = todayStrIST();
    const nowM = nowMinutesIST();
    const slots = await query(
      `SELECT id, name, time_label AS timeLabel, close_minutes AS closeMinutes,
              sort_order AS sortOrder
       FROM jackpot_slots
       WHERE is_active = 1
       ORDER BY sort_order ASC`,
      { today }
    );

    const items = slots.map((s) => {
      const closeM = Number(s.closeMinutes);
      let status = 'running';
      if (nowM >= closeM + 5) status = 'closed';
      else if (nowM >= closeM) status = 'closed';
      return {
        id: s.id,
        name: s.name,
        timeLabel: s.timeLabel,
        closeMinutes: closeM,
        status,
        result: null,
      };
    });

    res.json({ ok: true, items, date: today });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
