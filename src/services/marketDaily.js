/**
 * Persist one scraped market into market_daily for today's IST date.
 * - First seen today → INSERT
 * - Same market + date again → UPDATE timing/last_seen (no new row)
 * - When a real result appears → update result + result_declared
 * - Never overwrite a declared result with a placeholder
 */

const { query } = require('../config/db');
const { istDateString, toMysqlDatetime } = require('../utils/istDate');

function isPlaceholderResult(result) {
  const r = String(result || '').trim();
  if (!r) return true;
  if (/loading/i.test(r)) return true;
  if (/^[\*\-\s]+$/.test(r)) return true;
  if (/^\*+\s*-?\s*\*+$/.test(r)) return true;
  return false;
}

function isDeclaredResult(result) {
  if (isPlaceholderResult(result)) return false;
  // Need at least one digit (typical matka: 123-45-678 / 45 / etc.)
  return /\d/.test(String(result));
}

async function upsertMarketDaily({
  marketId,
  marketName,
  openTime,
  closeTime,
  scrapeTiming,
  result,
  now = new Date(),
}) {
  const resultDate = istDateString(now);
  const nowSql = toMysqlDatetime(now);
  const resultVal = (result || '').trim() || null;
  const declared = isDeclaredResult(resultVal) ? 1 : 0;

  const existing = await query(
    `SELECT id, result, result_declared
     FROM market_daily
     WHERE market_id = :marketId AND result_date = :resultDate
     LIMIT 1`,
    { marketId, resultDate }
  );

  if (!existing[0]) {
    await query(
      `INSERT INTO market_daily
        (market_id, market_name, result_date, open_time, close_time,
         scrape_timing, result, result_declared, first_seen_at, last_seen_at,
         result_updated_at)
       VALUES
        (:marketId, :marketName, :resultDate, :openTime, :closeTime,
         :scrapeTiming, :result, :declared, :now, :now,
         IF(:declared = 1, :now, NULL))`,
      {
        marketId,
        marketName: marketName.trim(),
        resultDate,
        openTime: openTime || null,
        closeTime: closeTime || null,
        scrapeTiming: scrapeTiming || null,
        result: resultVal,
        declared,
        now: nowSql,
      }
    );
    return {
      action: 'insert',
      resultDate,
      declared: !!declared,
      resultChanged: !!declared,
      shouldNotify: !!declared,
      result: resultVal,
      marketName: marketName.trim(),
      marketId,
    };
  }

  const row = existing[0];
  const alreadyDeclared = Number(row.result_declared) === 1;
  let nextResult = row.result;
  let nextDeclared = alreadyDeclared ? 1 : 0;
  let touchResultAt = null;
  let shouldNotify = false;

  if (declared) {
    // Real result arrived or changed → notify once per new/changed value
    if (!alreadyDeclared || String(row.result || '') !== String(resultVal)) {
      nextResult = resultVal;
      nextDeclared = 1;
      touchResultAt = nowSql;
      shouldNotify = true;
    }
  } else if (!alreadyDeclared && resultVal) {
    // Still placeholder / live text — keep latest text until declared
    nextResult = resultVal;
  }
  // If already declared and new scrape is placeholder → keep old result

  await query(
    `UPDATE market_daily SET
       market_name = :marketName,
       open_time = COALESCE(:openTime, open_time),
       close_time = COALESCE(:closeTime, close_time),
       scrape_timing = COALESCE(:scrapeTiming, scrape_timing),
       result = :result,
       result_declared = :declared,
       last_seen_at = :now,
       result_updated_at = COALESCE(:resultUpdatedAt, result_updated_at)
     WHERE id = :id`,
    {
      id: row.id,
      marketName: marketName.trim(),
      openTime: openTime || null,
      closeTime: closeTime || null,
      scrapeTiming: scrapeTiming || null,
      result: nextResult,
      declared: nextDeclared,
      now: nowSql,
      resultUpdatedAt: touchResultAt,
    }
  );

  return {
    action: 'update',
    resultDate,
    declared: !!nextDeclared,
    resultChanged: !!touchResultAt,
    shouldNotify,
    result: nextResult,
    marketName: marketName.trim(),
    marketId,
  };
}

module.exports = {
  upsertMarketDaily,
  isDeclaredResult,
  isPlaceholderResult,
};
