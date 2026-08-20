const { query } = require('../config/db');
const cache = require('../config/redis');

const CACHE_KEY = 'game:rates:v1';

const ALIAS = {
  'single-digit-bulk': 'single-digit',
  'jodi-bulk': 'jodi',
  'single-pana-bulk': 'single-pana',
  'double-pana-bulk': 'double-pana',
  'triple-pana-bulk': 'triple-pana',
  'half-sangam-a': 'half-sangam',
  'half-sangam-b': 'half-sangam',
};

function mapRow(r) {
  return {
    id: Number(r.id),
    kind: r.kind,
    gameId: r.gameId,
    gameName: r.gameName,
    heading: r.heading || 'Popular Games',
    amount: Number(r.amount || 0),
    rate: Number(r.rate || 0),
    sortOrder: Number(r.sortOrder || 0),
  };
}

async function listRates(kind) {
  const all = await listAllRates();
  if (!kind) return all;
  return all.filter((r) => r.kind === kind);
}

async function listAllRates() {
  const cached = await cache.get(CACHE_KEY);
  if (cached) return cached;
  const rows = await query(
    `SELECT id, market_kind AS kind, game_id AS gameId, game_name AS gameName,
            heading, amount, rate, sort_order AS sortOrder
     FROM game_rates
     ORDER BY
       CASE market_kind WHEN 'main' THEN 0 WHEN 'starline' THEN 1 ELSE 2 END,
       sort_order ASC, id ASC`
  );
  const items = rows.map(mapRow);
  await cache.set(CACHE_KEY, items, 120);
  return items;
}

async function getRate(kind, gameId) {
  const id = ALIAS[gameId] || gameId;
  const items = await listRates(kind);
  return items.find((r) => r.gameId === id) || null;
}

/** points * (rate / amount) — 10 ka 96 → bet 10 pays 96 */
async function payoutFor(kind, gameId, points) {
  const row = await getRate(kind, gameId);
  const p = Number(points) || 0;
  if (!row || !row.amount) {
    return p * 10;
  }
  return Math.round(((p * row.rate) / row.amount) * 100) / 100;
}

async function updateRate(id, body) {
  const rows = await query(`SELECT id FROM game_rates WHERE id = :id LIMIT 1`, {
    id,
  });
  if (!rows[0]) {
    const err = new Error('Game rate not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  await query(
    `UPDATE game_rates SET
       heading = COALESCE(:heading, heading),
       game_name = COALESCE(:gameName, game_name),
       amount = COALESCE(:amount, amount),
       rate = COALESCE(:rate, rate)
     WHERE id = :id`,
    {
      id,
      heading: body.heading != null ? String(body.heading).trim() : null,
      gameName: body.gameName != null ? String(body.gameName).trim() : null,
      amount: body.amount != null ? Number(body.amount) : null,
      rate: body.rate != null ? Number(body.rate) : null,
    }
  );
  await cache.del(CACHE_KEY);
  const updated = await query(
    `SELECT id, market_kind AS kind, game_id AS gameId, game_name AS gameName,
            heading, amount, rate, sort_order AS sortOrder
     FROM game_rates WHERE id = :id LIMIT 1`,
    { id }
  );
  return mapRow(updated[0]);
}

function publicByKind(items) {
  const out = { main: [], starline: [], jackpot: [] };
  for (const r of items) {
    if (!out[r.kind]) continue;
    out[r.kind].push({
      gameId: r.gameId,
      gameName: r.gameName,
      heading: r.heading,
      amount: r.amount,
      rate: r.rate,
      label: `${r.gameName.toUpperCase()}  ${r.amount}–${r.rate}`,
    });
  }
  return out;
}

module.exports = {
  listRates,
  listAllRates,
  getRate,
  payoutFor,
  updateRate,
  publicByKind,
};
