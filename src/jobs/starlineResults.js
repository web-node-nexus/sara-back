/**
 * Starline auto-result:
 * - After close + 5 minutes, pick open digit with least (or zero) money bet.
 * - Ank from single-digit bets directly; from 3-digit panas via (d1+d2+d3)%10;
 *   odd/even bets count toward 0-9 digits matching parity.
 */
const { query, withTransaction } = require('../config/db');
const { todayStrIST, nowMinutesIST } = require('../utils/istTime');
const { notifyResultToAllPlayersAsync } = require('../services/pushNotifications');
const { getAppSettings } = require('../services/appSettings');

function panaAnk(pana) {
  if (!/^\d{3}$/.test(String(pana))) return null;
  const s = String(pana);
  return (Number(s[0]) + Number(s[1]) + Number(s[2])) % 10;
}

function bidAnks(gameId, number) {
  const n = String(number || '');
  if (gameId === 'single-digit' || gameId === 'single-digit-bulk') {
    if (/^\d$/.test(n)) return [Number(n)];
    return [];
  }
  if (gameId === 'odd-even') {
    const odd = n.toLowerCase() === 'odd';
    const even = n.toLowerCase() === 'even';
    if (!odd && !even) return [];
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) =>
      odd ? d % 2 === 1 : d % 2 === 0
    );
  }
  // panas / motors / family / sp-dp-tp → 3-digit
  const ank = panaAnk(n);
  return ank == null ? [] : [ank];
}

function pickLeastAnk(totals) {
  let best = 0;
  let bestAmt = totals[0] ?? 0;
  for (let d = 1; d <= 9; d++) {
    const amt = totals[d] ?? 0;
    if (amt < bestAmt) {
      best = d;
      bestAmt = amt;
    }
  }
  return best;
}

function isWinningBid(gameId, number, openDigit) {
  const n = String(number || '');
  if (gameId === 'single-digit' || gameId === 'single-digit-bulk') {
    return Number(n) === openDigit;
  }
  if (gameId === 'odd-even') {
    const odd = openDigit % 2 === 1;
    return (
      (n.toLowerCase() === 'odd' && odd) ||
      (n.toLowerCase() === 'even' && !odd)
    );
  }
  const ank = panaAnk(n);
  return ank != null && ank === openDigit;
}

const { payoutFor } = require('../services/gameRates');

/** Payout from admin Game Rates: points * (rate / amount) */
async function winAmount(gameId, points) {
  return payoutFor('starline', gameId, points);
}

async function declareSlot(slot, today, opts = {}) {
  const forcedDigit =
    opts.openDigit != null && Number.isFinite(Number(opts.openDigit))
      ? Number(opts.openDigit)
      : null;

  const prev = await query(
    `SELECT open_digit AS openDigit, result_display AS result
     FROM starline_results
     WHERE slot_id = :slotId AND result_date = :today
     LIMIT 1`,
    { slotId: slot.id, today }
  );

  const bids = await query(
    `SELECT id, user_id AS userId, game_id AS gameId, number_value AS number, points, status
     FROM bids
     WHERE market_id = :slotId
       AND DATE(created_at) = :today
       AND status = 'pending'`,
    { slotId: slot.id, today }
  );

  const totals = Array.from({ length: 10 }, () => 0);
  for (const b of bids) {
    const anks = bidAnks(b.gameId, b.number);
    // Split points across matching anks for odd/even so each digit gets fair share
    const share = anks.length ? Number(b.points) / anks.length : 0;
    for (const a of anks) totals[a] += share;
  }

  const openDigit =
    forcedDigit != null ? Math.max(0, Math.min(9, forcedDigit)) : pickLeastAnk(totals);
  const resultDisplay = `***-${openDigit}`;

  const isNew = !prev[0];
  const changed =
    isNew ||
    Number(prev[0].openDigit) !== openDigit ||
    String(prev[0].result || '') !== resultDisplay;

  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO starline_results
        (slot_id, result_date, open_digit, result_display, declared_at)
       VALUES (:slotId, :today, :digit, :display, NOW())
       ON DUPLICATE KEY UPDATE
         open_digit = VALUES(open_digit),
         result_display = VALUES(result_display),
         declared_at = VALUES(declared_at)`,
      {
        slotId: slot.id,
        today,
        digit: openDigit,
        display: resultDisplay,
      }
    );

    for (const b of bids) {
      const won = isWinningBid(b.gameId, b.number, openDigit);
      await conn.execute(
        `UPDATE bids SET status = :status WHERE id = :id AND status = 'pending'`,
        { status: won ? 'won' : 'lost', id: b.id }
      );
      if (won) {
        const payout = await winAmount(b.gameId, b.points);
        const [wallets] = await conn.execute(
          `SELECT balance FROM wallets WHERE user_id = :userId FOR UPDATE`,
          { userId: b.userId }
        );
        if (!wallets[0]) continue;
        const balance = Number(wallets[0].balance) + payout;
        await conn.execute(
          `UPDATE wallets SET balance = :balance, version = version + 1 WHERE user_id = :userId`,
          { balance, userId: b.userId }
        );
        await conn.execute(
          `INSERT INTO wallet_ledger
            (user_id, type, amount, balance_after, note, ref_type)
           VALUES (:userId, 'win', :amount, :balanceAfter, :note, 'starline')`,
          {
            userId: b.userId,
            amount: payout,
            balanceAfter: balance,
            note: `Starline win · ${slot.name} · ${b.number}`,
          }
        );
      }
    }
  });

  console.log(
    `[starline] ${slot.id} ${today} → ${resultDisplay} (${bids.length} bids)`
  );

  if (changed) {
    notifyResultToAllPlayersAsync({
      kind: 'starline',
      marketId: slot.id,
      marketName: slot.name,
      result: resultDisplay,
      resultDate: today,
    });
  }

  return {
    openDigit,
    result: resultDisplay,
    notified: changed,
    isNew,
  };
}

async function runStarlineResultsOnce() {
  const settings = await getAppSettings();
  if (!settings.starlineAutoResult) return;

  const today = todayStrIST();
  const nowM = nowMinutesIST();
  const slots = await query(
    `SELECT id, name, close_minutes AS closeMinutes
     FROM starline_slots WHERE is_active = 1`
  );

  for (const slot of slots) {
    const closeM = Number(slot.closeMinutes);
    if (nowM < closeM + 5) continue;

    const existing = await query(
      `SELECT id FROM starline_results
       WHERE slot_id = :slotId AND result_date = :today LIMIT 1`,
      { slotId: slot.id, today }
    );
    if (existing.length) continue;

    try {
      await declareSlot(slot, today);
    } catch (err) {
      console.error(`[starline] declare failed ${slot.id}:`, err.message);
    }
  }
}

function startStarlineJob() {
  const tick = () => {
    void runStarlineResultsOnce().catch((err) =>
      console.error('[starline] job error:', err.message)
    );
  };
  tick();
  setInterval(tick, 60_000);
  console.log('[starline] Auto-result job every 60s (+5 min after close)');
}

module.exports = { startStarlineJob, runStarlineResultsOnce, declareSlot };
