/**
 * Shared declare-result helper for markets / jackpot (scraped or admin).
 * Updates markets + market_daily and returns whether push should fire.
 */
const { query } = require('../config/db');
const { upsertMarketDaily, isDeclaredResult } = require('./marketDaily');
const {
  notifyResultToAllPlayersAsync,
  detectResultKind,
} = require('./pushNotifications');
const { istDateString } = require('../utils/istDate');

/**
 * @returns {{ ok: boolean, notified: boolean, result: string|null, kind: string }}
 */
async function declareMarketResult({
  marketId,
  marketName,
  result,
  openTime,
  closeTime,
  scrapeTiming,
  source = 'admin',
}) {
  const resultVal = String(result || '').trim();
  if (!resultVal || !isDeclaredResult(resultVal)) {
    const err = new Error('Enter a valid declared result (must include digits)');
    err.status = 400;
    err.code = 'INVALID_RESULT';
    throw err;
  }

  let name = marketName;
  let open = openTime || null;
  let close = closeTime || null;

  if (!name || !open || !close) {
    const rows = await query(
      `SELECT name, open_time AS openTime, close_time AS closeTime
       FROM markets WHERE id = :id LIMIT 1`,
      { id: marketId }
    );
    if (!rows[0] && !name) {
      const err = new Error('Market not found');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (rows[0]) {
      name = name || rows[0].name;
      open = open || rows[0].openTime;
      close = close || rows[0].closeTime;
    }
  }

  const kind = detectResultKind({ marketId, marketName: name });
  const todayIst = istDateString();

  const dailyOut = await upsertMarketDaily({
    marketId,
    marketName: name,
    openTime: open,
    closeTime: close,
    scrapeTiming: scrapeTiming || null,
    result: resultVal,
  });

  await query(
    `UPDATE markets
     SET result = :result,
         result_updated_at = NOW()
     WHERE id = :id`,
    { id: marketId, result: resultVal }
  );

  // If market row missing (edge), ignore update count

  const shouldNotify = !!dailyOut?.shouldNotify && !!dailyOut.result;
  if (shouldNotify) {
    notifyResultToAllPlayersAsync({
      kind,
      marketId,
      marketName: name,
      result: dailyOut.result,
      resultDate: dailyOut.resultDate || todayIst,
    });
  }

  return {
    ok: true,
    notified: shouldNotify,
    result: dailyOut?.result || resultVal,
    resultDate: dailyOut?.resultDate || todayIst,
    kind,
    source,
    marketId,
    marketName: name,
  };
}

module.exports = {
  declareMarketResult,
};
