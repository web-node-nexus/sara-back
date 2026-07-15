const express = require('express');
const { query } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const cache = require('../../config/redis');

const router = express.Router();

const GAMES = [
  { id: 'single-digit', name: 'Single Digit', icon: 'single-digit', tint: '#F0C14A' },
  { id: 'jodi', name: 'Jodi', icon: 'jodi', tint: '#E8A838' },
  { id: 'double-digit', name: 'Double Digit', icon: 'double-digit', tint: '#D4A84B' },
  { id: 'single-pana', name: 'Single Pana', icon: 'single-pana', tint: '#C9A227' },
  { id: 'double-pana', name: 'Double Pana', icon: 'double-pana', tint: '#B8923A' },
  { id: 'triple-pana', name: 'Triple Pana', icon: 'triple-pana', tint: '#E8B84A' },
  { id: 'pana-family', name: 'Pana Family', icon: 'pana-family', tint: '#F5D76E' },
  { id: 'full-sangam', name: 'Full Sangam', icon: 'full-sangam', tint: '#F0C14A' },
  { id: 'half-sangam-a', name: 'Half Sangam (A)', icon: 'half-sangam', tint: '#E8A838' },
  { id: 'half-sangam-b', name: 'Half Sangam (B)', icon: 'half-sangam', tint: '#D4A84B' },
  { id: 'single-digit-bulk', name: 'Single Digit Bulk', icon: 'bulk', tint: '#C9A227' },
  { id: 'single-pana-bulk', name: 'Single Pana Bulk', icon: 'bulk', tint: '#B8923A' },
  { id: 'double-pana-bulk', name: 'Double Pana Bulk', icon: 'bulk', tint: '#E8B84A' },
  { id: 'triple-pana-bulk', name: 'Triple Pana Bulk', icon: 'bulk', tint: '#F0C14A' },
  { id: 'two-digit-pana', name: 'Two Digit Pana', icon: 'two-digit-pana', tint: '#F5D76E' },
];

function formatAmPm(timeStr) {
  // HH:MM:SS → h:mm AM/PM
  const [h, m] = String(timeStr).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const cached = await cache.get('markets:v2');
    if (cached) return res.json({ ok: true, items: cached, cached: true });

    const rows = await query(
      `SELECT id, name, open_time AS openTimeRaw, close_time AS closeTimeRaw,
              is_active AS isActive, sort_order AS sortOrder
       FROM markets
       WHERE is_active = 1
       ORDER BY sort_order ASC, name ASC
       LIMIT 50`
    );
    const items = rows.map((r, index) => ({
      id: r.id,
      name: r.name,
      openTime: formatAmPm(r.openTimeRaw),
      closeTime: formatAmPm(r.closeTimeRaw),
      openTimeRaw: r.openTimeRaw,
      closeTimeRaw: r.closeTimeRaw,
      status: 'live',
      index: index + 1,
      isActive: !!r.isActive,
    }));
    await cache.set('markets:v2', items, 60);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/games', requireAuth, async (req, res, next) => {
  try {
    const markets = await query(
      `SELECT id, name FROM markets WHERE id = :id AND is_active = 1 LIMIT 1`,
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
