const express = require('express');
const { z } = require('zod');
const { query } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

const router = express.Router();

const TABLE = {
  starline: 'starline_slots',
  jackpot: 'jackpot_slots',
};

const NAME_SUFFIX = {
  starline: 'STARLINE',
  jackpot: 'JACKPOT',
};

function parseKind(raw) {
  const k = String(raw || 'starline').toLowerCase();
  if (!TABLE[k]) return null;
  return k;
}

/** "10:30 AM" → minutes from midnight */
function timeLabelToMinutes(label) {
  const m = String(label || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

function normalizeTimeLabel(input) {
  const m = String(input || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]} ${m[3].toUpperCase()}`;
}

function mapRow(r) {
  return {
    id: r.id,
    name: r.name,
    timeLabel: r.timeLabel,
    closeMinutes: Number(r.closeMinutes),
    isActive: !!r.isActive,
    play: !!r.isActive,
    sortOrder: Number(r.sortOrder),
  };
}

function listSql(table) {
  return `SELECT id, name, time_label AS timeLabel, close_minutes AS closeMinutes,
                 is_active AS isActive, sort_order AS sortOrder
          FROM ${table}
          ORDER BY sort_order ASC, close_minutes ASC`;
}

/** List starline or jackpot slots for Game On/Off screen */
router.get(
  '/game-on-off',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const kind = parseKind(req.query.kind);
      if (!kind) {
        return res.status(400).json({
          ok: false,
          error: 'INVALID_KIND',
          message: 'kind must be starline or jackpot',
        });
      }
      const rows = await query(listSql(TABLE[kind]));
      res.json({ ok: true, kind, items: rows.map(mapRow) });
    } catch (err) {
      next(err);
    }
  }
);

/** Toggle play ON/OFF */
router.patch(
  '/:kind/:id/play',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        return res.status(400).json({ ok: false, error: 'INVALID_KIND' });
      }
      const id = String(req.params.id);
      const body = z.object({ play: z.boolean() }).parse(req.body);
      const table = TABLE[kind];

      const rows = await query(
        `SELECT id FROM ${table} WHERE id = :id LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      await query(`UPDATE ${table} SET is_active = :active WHERE id = :id`, {
        id,
        active: body.play ? 1 : 0,
      });

      const updated = await query(
        `SELECT id, name, time_label AS timeLabel, close_minutes AS closeMinutes,
                is_active AS isActive, sort_order AS sortOrder
         FROM ${table} WHERE id = :id LIMIT 1`,
        { id }
      );
      res.json({ ok: true, kind, slot: mapRow(updated[0]) });
    } catch (err) {
      next(err);
    }
  }
);

/** Edit slot time / name */
router.patch(
  '/:kind/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const kind = parseKind(req.params.kind);
      if (!kind) {
        return res.status(400).json({ ok: false, error: 'INVALID_KIND' });
      }
      const id = String(req.params.id);
      const body = z
        .object({
          timeLabel: z.string().min(3).max(32),
        })
        .parse(req.body);

      const timeLabel = normalizeTimeLabel(body.timeLabel);
      if (!timeLabel) {
        return res.status(400).json({
          ok: false,
          error: 'INVALID_TIME',
          message: 'Use time like 10:30 AM',
        });
      }

      const closeMinutes = timeLabelToMinutes(timeLabel);

      const table = TABLE[kind];
      const rows = await query(
        `SELECT id FROM ${table} WHERE id = :id LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      const name = `${timeLabel} ${NAME_SUFFIX[kind]}`;

      await query(
        `UPDATE ${table}
         SET time_label = :timeLabel, name = :name, close_minutes = :closeMinutes
         WHERE id = :id`,
        { id, timeLabel, name, closeMinutes }
      );

      const updated = await query(
        `SELECT id, name, time_label AS timeLabel, close_minutes AS closeMinutes,
                is_active AS isActive, sort_order AS sortOrder
         FROM ${table} WHERE id = :id LIMIT 1`,
        { id }
      );
      res.json({ ok: true, kind, slot: mapRow(updated[0]) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
