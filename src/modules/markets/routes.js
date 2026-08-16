const express = require('express');
const { query } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { istDateString } = require('../../utils/istDate');

const router = express.Router();

const GAMES = [
  { id: 'single-digit', name: 'Single Digit', icon: 'single-digit', tint: '#3DDC84' },
  { id: 'single-digit-bulk', name: 'Single Digit Bulk', icon: 'bulk', tint: '#E85D5D' },
  { id: 'jodi', name: 'Jodi', icon: 'jodi', tint: '#5DADE2' },
  { id: 'jodi-bulk', name: 'Jodi Bulk', icon: 'bulk', tint: '#2E86C1' },
  { id: 'single-pana', name: 'Single Pana', icon: 'single-pana', tint: '#E8A838' },
  { id: 'single-pana-bulk', name: 'Single Pana Bulk', icon: 'bulk', tint: '#9B59B6' },
  { id: 'double-pana', name: 'Double Pana', icon: 'double-pana', tint: '#B8923A' },
  { id: 'double-pana-bulk', name: 'Double Pana Bulk', icon: 'bulk', tint: '#7F8C8D' },
  { id: 'triple-pana', name: 'Triple Pana', icon: 'triple-pana', tint: '#8E44AD' },
  { id: 'full-sangam', name: 'Full Sangam', icon: 'full-sangam', tint: '#E67E22' },
  { id: 'half-sangam-a', name: 'Half Sangam (A)', icon: 'half-sangam', tint: '#C0399B' },
  { id: 'half-sangam-b', name: 'Half Sangam (B)', icon: 'half-sangam', tint: '#E74C3C' },
  { id: 'pana-family', name: 'Pana Family', icon: 'pana-family', tint: '#1ABC9C' },
  { id: 'sp-dp-tp', name: 'SP DP TP', icon: 'triple-pana', tint: '#16A085' },
  { id: 'two-digit-pana', name: 'Two Digit Pana', icon: 'two-digit-pana', tint: '#A8E610' },
  { id: 'sp-motor', name: 'SP MOTER', icon: 'bulk', tint: '#9B59B6' },
  { id: 'dp-motor', name: 'DP MOTER', icon: 'bulk', tint: '#27AE60' },
  { id: 'jodi-family', name: 'Jodi Family', icon: 'jodi', tint: '#5DADE2' },
  { id: 'red-jodi', name: 'Red Jodi', icon: 'jodi', tint: '#E85D8A' },
  { id: 'odd-even', name: 'Odd Even', icon: 'single-digit', tint: '#1ABC9C' },
  { id: 'sp-common', name: 'SP Common', icon: 'single-pana', tint: '#9B59B6' },
  { id: 'dp-common', name: 'DP Common', icon: 'double-pana', tint: '#27AE60' },
  { id: 'cycle-jodi', name: 'Cycle Jodi', icon: 'jodi', tint: '#8E44AD' },
  { id: 'digit-based-jodi', name: 'Digit Based Jodi', icon: 'jodi', tint: '#B8923A' },
];

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatAmPm(timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function todayKey(date = new Date()) {
  return DAY_KEYS[date.getDay()];
}

function playsToday(playDays, dayKey) {
  if (playDays == null || String(playDays).trim() === '') return true;
  const parts = String(playDays)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.includes(dayKey);
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const cached = await cache.get('markets:v2');
    if (cached) return res.json({ ok: true, items: cached, cached: true });

    const dayKey = todayKey();
    // Merge: DB (admin + seed) + scrape markets — all active rows
    const rows = await query(
      `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
              is_active AS isActive, sort_order AS sortOrder, source,
              play_days AS playDays,
              result, result_updated_at AS resultUpdatedAt, scrape_timing AS scrapeTiming
       FROM markets
       WHERE is_active = 1
         AND source IN ('scrape', 'admin', 'seed')
       ORDER BY
         CASE source
           WHEN 'admin' THEN 0
           WHEN 'seed' THEN 1
           ELSE 2
         END,
         sort_order ASC,
         name ASC
       LIMIT 150`
    );

    const items = rows
      .filter((r) => playsToday(r.playDays, dayKey))
      .map((r, index) => ({
        id: r.id,
        name: r.name,
        openTime: formatAmPm(r.openTimeRaw),
        closeTime: formatAmPm(r.closeTimeRaw),
        openTimeRaw: r.openTimeRaw,
        closeTimeRaw: r.closeTimeRaw,
        result: r.result || null,
        resultUpdatedAt: r.resultUpdatedAt || null,
        scrapeTiming: r.scrapeTiming || null,
        source: r.source || 'scrape',
        status: 'live',
        index: index + 1,
        isActive: !!r.isActive,
      }));

    await cache.set('markets:v2', items, 90);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/** Declared results for a date (user home / charts). Saved in market_daily. */
router.get('/results', requireAuth, async (req, res, next) => {
  try {
    const date = String(req.query.date || istDateString()).slice(0, 10);
    const marketId = String(req.query.marketId || '').trim();
    const params = { date };
    let where = 'md.result_date = :date AND md.result_declared = 1';
    if (marketId) {
      where += ' AND md.market_id = :marketId';
      params.marketId = marketId;
    }
    const rows = await query(
      `SELECT md.market_id AS id, md.market_name AS name, md.result,
              md.result_date AS resultDate,
              md.open_time AS openTime, md.close_time AS closeTime,
              md.result_updated_at AS resultUpdatedAt,
              m.source
       FROM market_daily md
       LEFT JOIN markets m ON m.id = md.market_id
       WHERE ${where}
       ORDER BY md.open_time IS NULL, md.open_time, md.market_name`,
      params
    );
    res.json({ ok: true, date, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/results', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 90);
    const rows = await query(
      `SELECT md.market_id AS id, md.market_name AS name, md.result,
              md.result_date AS resultDate,
              md.open_time AS openTime, md.close_time AS closeTime,
              md.result_updated_at AS resultUpdatedAt,
              md.result_declared AS resultDeclared
       FROM market_daily md
       WHERE md.market_id = :id AND md.result_declared = 1
       ORDER BY md.result_date DESC
       LIMIT ${limit}`,
      { id: req.params.id }
    );
    res.json({ ok: true, marketId: req.params.id, items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/games', requireAuth, async (req, res, next) => {
  try {
    const markets = await query(
      `SELECT id, name FROM markets
       WHERE id = :id AND is_active = 1
       LIMIT 1`,
      { id: req.params.id }
    );
    if (!markets[0]) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    res.json({
      ok: true,
      market: markets[0],
      games: GAMES.map((g) => ({ ...g, hint: '' })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
