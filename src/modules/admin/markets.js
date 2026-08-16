const express = require('express');
const { z } = require('zod');
const { query } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { declareMarketResult } = require('../../services/declareResult');

const router = express.Router();

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return s || `m-${Date.now()}`;
}

/** "09:40 AM" | "09:40:00" → HH:MM:SS */
function parseToSqlTime(input) {
  const raw = String(input || '').trim();
  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (/pm/i.test(m12[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${m12[2]}:00`;
  }
  const m24 = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m24) {
    return `${String(Number(m24[1]) % 24).padStart(2, '0')}:${m24[2]}:${m24[3] || '00'}`;
  }
  return null;
}

function formatAmPm(timeStr) {
  const [h, m] = String(timeStr || '00:00:00').split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function normalizePlayDays(input) {
  if (input == null || input === '') return DAYS.join(',');
  let list = Array.isArray(input)
    ? input
    : String(input)
        .split(/[,|]/)
        .map((s) => s.trim())
        .filter(Boolean);
  const map = {
    monday: 'Mon',
    mon: 'Mon',
    tuesday: 'Tue',
    tue: 'Tue',
    wednesday: 'Wed',
    wed: 'Wed',
    thursday: 'Thu',
    thu: 'Thu',
    friday: 'Fri',
    fri: 'Fri',
    saturday: 'Sat',
    sat: 'Sat',
    sunday: 'Sun',
    sun: 'Sun',
  };
  const out = [];
  for (const d of list) {
    const key = map[String(d).toLowerCase()] || (DAYS.includes(d) ? d : null);
    if (key && !out.includes(key)) out.push(key);
  }
  return out.length ? out.join(',') : DAYS.join(',');
}

function mapRow(r) {
  const playDays = r.playDays
    ? String(r.playDays)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [...DAYS];
  return {
    id: r.id,
    name: r.name,
    openTime: formatAmPm(r.openTimeRaw),
    closeTime: formatAmPm(r.closeTimeRaw),
    openTimeRaw: r.openTimeRaw,
    closeTimeRaw: r.closeTimeRaw,
    isActive: !!r.isActive,
    play: !!r.isActive,
    playDays,
    playDaysLabel: playDays
      .map((d) => {
        const full = {
          Mon: 'Monday',
          Tue: 'Tuesday',
          Wed: 'Wednesday',
          Thu: 'Thursday',
          Fri: 'Friday',
          Sat: 'Saturday',
          Sun: 'Sunday',
        };
        return full[d] || d;
      })
      .join(', '),
    source: r.source,
    sortOrder: r.sortOrder,
    result: r.result || null,
  };
}

async function bustCache() {
  await cache.del('markets:v2');
}

/** Admin-created markets only — Game On/Off screen */
router.get(
  '/game-on-off',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
                is_active AS isActive, source, sort_order AS sortOrder,
                play_days AS playDays, result
         FROM markets
         WHERE source = 'admin'
         ORDER BY sort_order ASC, open_time ASC, name ASC`
      );
      res.json({ ok: true, items: rows.map(mapRow) });
    } catch (err) {
      next(err);
    }
  }
);

/** Toggle play for admin-created market only */
router.patch(
  '/:id/play',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const body = z.object({ play: z.boolean() }).parse(req.body);

      const rows = await query(
        `SELECT id, source FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (rows[0].source !== 'admin') {
        return res.status(403).json({
          ok: false,
          error: 'NOT_ADMIN_MARKET',
          message: 'Only admin-created games can be toggled here',
        });
      }

      await query(`UPDATE markets SET is_active = :active WHERE id = :id`, {
        id,
        active: body.play ? 1 : 0,
      });
      await bustCache();

      const updated = await query(
        `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
                is_active AS isActive, source, sort_order AS sortOrder,
                play_days AS playDays, result
         FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      res.json({ ok: true, market: mapRow(updated[0]) });
    } catch (err) {
      next(err);
    }
  }
);

/** List all markets for admin (scrape + admin + seed) */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = await query(
      `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
              is_active AS isActive, source, sort_order AS sortOrder,
              play_days AS playDays, result
       FROM markets
       WHERE (:q = '' OR name LIKE CONCAT('%', :q, '%') OR id LIKE CONCAT('%', :q, '%'))
       ORDER BY
         CASE source WHEN 'admin' THEN 0 WHEN 'scrape' THEN 1 ELSE 2 END,
         sort_order ASC, name ASC
       LIMIT 200`,
      { q }
    );
    res.json({ ok: true, items: rows.map(mapRow) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(2).max(120),
        openTime: z.string().min(3).max(20),
        closeTime: z.string().min(3).max(20),
        isActive: z.boolean().optional().default(true),
        playDays: z.union([z.array(z.string()), z.string()]).optional(),
        sortOrder: z.number().int().optional(),
        id: z.string().min(2).max(40).optional(),
      })
      .parse(req.body);

    const name = body.name.trim().toUpperCase();
    const openSql = parseToSqlTime(body.openTime);
    const closeSql = parseToSqlTime(body.closeTime);
    if (!openSql || !closeSql) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_TIME',
        message: 'Use times like 09:40 AM',
      });
    }

    let id = (body.id || slugify(name)).slice(0, 40);
    const existing = await query(
      `SELECT id, source FROM markets WHERE id = :id LIMIT 1`,
      { id }
    );
    if (existing[0]) {
      if (existing[0].source !== 'admin') {
        id = `a-${id}`.slice(0, 40);
      } else {
        return res.status(409).json({
          ok: false,
          error: 'ID_TAKEN',
          message: 'Market id already exists',
        });
      }
    }

    const playDays = normalizePlayDays(body.playDays);
    const sortOrder =
      body.sortOrder != null
        ? body.sortOrder
        : 500 + Math.floor(Math.random() * 100);

    await query(
      `INSERT INTO markets
        (id, name, open_time, close_time, is_active, source, sort_order, play_days)
       VALUES
        (:id, :name, :openTime, :closeTime, :active, 'admin', :sort, :playDays)`,
      {
        id,
        name,
        openTime: openSql,
        closeTime: closeSql,
        active: body.isActive ? 1 : 0,
        sort: sortOrder,
        playDays,
      }
    );
    await bustCache();

    const rows = await query(
      `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
              is_active AS isActive, source, sort_order AS sortOrder,
              play_days AS playDays, result
       FROM markets WHERE id = :id LIMIT 1`,
      { id }
    );
    res.status(201).json({ ok: true, market: mapRow(rows[0]) });
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
      const id = String(req.params.id);
      const body = z
        .object({
          name: z.string().min(2).max(120).optional(),
          openTime: z.string().min(3).max(20).optional(),
          closeTime: z.string().min(3).max(20).optional(),
          isActive: z.boolean().optional(),
          playDays: z.union([z.array(z.string()), z.string()]).optional(),
          sortOrder: z.number().int().optional(),
        })
        .parse(req.body);

      const rows = await query(
        `SELECT id, source FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      // Admin can edit admin markets fully; scrape/seed: toggle + times + days only (keep source)
      const openSql = body.openTime ? parseToSqlTime(body.openTime) : null;
      const closeSql = body.closeTime ? parseToSqlTime(body.closeTime) : null;
      if (body.openTime && !openSql) {
        return res.status(400).json({ ok: false, error: 'INVALID_OPEN_TIME' });
      }
      if (body.closeTime && !closeSql) {
        return res.status(400).json({ ok: false, error: 'INVALID_CLOSE_TIME' });
      }

      await query(
        `UPDATE markets SET
           name = COALESCE(:name, name),
           open_time = COALESCE(:openTime, open_time),
           close_time = COALESCE(:closeTime, close_time),
           is_active = COALESCE(:active, is_active),
           play_days = COALESCE(:playDays, play_days),
           sort_order = COALESCE(:sort, sort_order)
         WHERE id = :id`,
        {
          id,
          name: body.name != null ? body.name.trim().toUpperCase() : null,
          openTime: openSql,
          closeTime: closeSql,
          active: body.isActive == null ? null : body.isActive ? 1 : 0,
          playDays:
            body.playDays != null ? normalizePlayDays(body.playDays) : null,
          sort: body.sortOrder != null ? body.sortOrder : null,
        }
      );
      await bustCache();

      const updated = await query(
        `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
                is_active AS isActive, source, sort_order AS sortOrder,
                play_days AS playDays, result
         FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      res.json({ ok: true, market: mapRow(updated[0]) });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const rows = await query(
        `SELECT id, source FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (rows[0].source === 'scrape') {
        // Soft-delete scrape markets so scraper can revive; don't hard delete
        await query(`UPDATE markets SET is_active = 0 WHERE id = :id`, { id });
      } else {
        await query(`DELETE FROM markets WHERE id = :id`, { id });
      }
      await bustCache();
      res.json({ ok: true, deleted: true, id });
    } catch (err) {
      next(err);
    }
  }
);

/** Admin declare market / jackpot result → push all users */
router.post(
  '/:id/declare-result',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const body = z
        .object({
          result: z.string().min(1).max(64),
        })
        .parse(req.body);

      const rows = await query(
        `SELECT id, name, source,
                open_time AS openTime, close_time AS closeTime
         FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (rows[0].source !== 'admin') {
        return res.status(403).json({
          ok: false,
          error: 'NOT_ADMIN_MARKET',
          message:
            'Only admin-created games can be declared here. Scraped markets get results automatically.',
        });
      }

      const out = await declareMarketResult({
        marketId: rows[0].id,
        marketName: rows[0].name,
        openTime: rows[0].openTime,
        closeTime: rows[0].closeTime,
        result: body.result,
        source: 'admin',
      });
      await bustCache();
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
