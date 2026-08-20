/**
 * Shared declare-result helper for markets / jackpot (scraped or admin).
 * Updates markets + market_daily and returns whether push should fire.
 */
const { query, withTransaction } = require('../config/db');
const cache = require('../config/redis');
const { upsertMarketDaily, isDeclaredResult } = require('./marketDaily');
const {
  notifyResultToAllPlayersAsync,
  detectResultKind,
} = require('./pushNotifications');
const { istDateString, istDayBounds, toMysqlDatetime } = require('../utils/istDate');
const {
  mergeOpenClose,
  parseMatkaResult,
  formatOpenResult,
} = require('../utils/matkaResult');

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
  session = 'full',
  resultDate,
}) {
  const incoming = String(result || '').trim();
  if (!incoming || !isDeclaredResult(incoming)) {
    const err = new Error('Enter a valid declared result (must include digits)');
    err.status = 400;
    err.code = 'INVALID_RESULT';
    throw err;
  }

  const date = resultDate || istDateString();
  let resultVal = incoming;
  if (session === 'open' || session === 'close') {
    const daily = await query(
      `SELECT result FROM market_daily
       WHERE market_id = :id AND result_date = :date
       LIMIT 1`,
      { id: marketId, date }
    );
    resultVal = mergeOpenClose(daily[0]?.result || '', session, incoming);
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
  const todayIst = date || istDateString();

  const dailyOut = await upsertMarketDaily({
    marketId,
    marketName: name,
    openTime: open,
    closeTime: close,
    scrapeTiming: scrapeTiming || null,
    result: resultVal,
    resultDate: todayIst,
  });

  if (todayIst === istDateString()) {
    await query(
      `UPDATE markets
       SET result = :result,
           result_updated_at = NOW()
       WHERE id = :id`,
      { id: marketId, result: resultVal }
    );
  }

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
    session,
    parsed: parseMatkaResult(dailyOut?.result || resultVal),
  };
}

async function reverseMarketResult({ marketId, session, resultDate }) {
  const date = resultDate || istDateString();
  const sess = session === 'open' ? 'open' : 'close';

  const markets = await query(
    `SELECT id, name FROM markets WHERE id = :id LIMIT 1`,
    { id: marketId }
  );
  if (!markets[0]) {
    const err = new Error('Market not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const daily = await query(
    `SELECT id, result, result_declared AS declared
     FROM market_daily
     WHERE market_id = :id AND result_date = :date
     LIMIT 1`,
    { id: marketId, date }
  );
  if (!daily[0] || !daily[0].result) {
    const err = new Error('Is date pe koi result nahi hai');
    err.status = 400;
    err.code = 'NO_RESULT';
    throw err;
  }

  const parsed = parseMatkaResult(daily[0].result);
  if (sess === 'close' && !parsed.hasClose) {
    const err = new Error('Close result declare nahi hua');
    err.status = 400;
    err.code = 'NO_CLOSE';
    throw err;
  }
  if (sess === 'open' && !parsed.hasOpen) {
    const err = new Error('Open result declare nahi hua');
    err.status = 400;
    err.code = 'NO_OPEN';
    throw err;
  }
  if (sess === 'open' && parsed.hasClose) {
    const err = new Error('Pehle Close result reverse karein');
    err.status = 400;
    err.code = 'CLOSE_EXISTS';
    throw err;
  }

  const { start, end } = istDayBounds(date);
  const startSql = toMysqlDatetime(start);
  const endSql = toMysqlDatetime(end);
  const sessionSql =
    sess === 'close'
      ? `AND b.session = 'close'`
      : `AND (b.session = 'open' OR b.session IS NULL)`;

  const out = await withTransaction(async (conn) => {
    const [bids] = await conn.execute(
      `SELECT id, user_id AS userId, win_amount AS winAmount, status
       FROM bids b
       WHERE b.market_id = :marketId
         AND b.created_at >= :startSql
         AND b.created_at < :endSql
         AND b.status IN ('won', 'lost')
         ${sessionSql}
       FOR UPDATE`,
      { marketId, startSql, endSql }
    );

    let reversedWins = 0;
    let deducted = 0;

    for (const bid of bids || []) {
      const payout = Number(bid.winAmount || 0);
      if (bid.status === 'won' && payout > 0) {
        const [wallets] = await conn.execute(
          `SELECT balance FROM wallets WHERE user_id = :userId FOR UPDATE`,
          { userId: bid.userId }
        );
        if (wallets[0]) {
          const nextBal = Math.max(0, Number(wallets[0].balance) - payout);
          await conn.execute(
            `UPDATE wallets SET balance = :balance, version = version + 1
             WHERE user_id = :userId`,
            { balance: nextBal, userId: bid.userId }
          );
          await conn.execute(
            `INSERT INTO wallet_ledger
              (user_id, type, amount, balance_after, note, ref_type, ref_id)
             VALUES
              (:userId, 'adjust', :amount, :balanceAfter, :note, 'bid_reverse', :refId)`,
            {
              userId: bid.userId,
              amount: -payout,
              balanceAfter: nextBal,
              note: `Bid reverse · ${markets[0].name} · ${sess} · ${date}`,
              refId: String(bid.id),
            }
          );
          deducted += payout;
        }
        reversedWins += 1;
      }
    }

    await conn.execute(
      `UPDATE bids b
       SET status = 'pending', win_amount = 0
       WHERE b.market_id = :marketId
         AND b.created_at >= :startSql
         AND b.created_at < :endSql
         AND b.status IN ('won', 'lost')
         ${sessionSql}`,
      { marketId, startSql, endSql }
    );

    let nextResult = null;
    let nextDeclared = 0;
    if (sess === 'close' && parsed.hasOpen) {
      nextResult = parsed.openText || formatOpenResult(daily[0].result);
      nextDeclared = nextResult ? 1 : 0;
    }

    await conn.execute(
      `UPDATE market_daily
       SET result = :result,
           result_declared = :declared,
           result_updated_at = NOW()
       WHERE id = :id`,
      {
        id: daily[0].id,
        result: nextResult,
        declared: nextDeclared,
      }
    );

    if (date === istDateString()) {
      await conn.execute(
        `UPDATE markets SET result = :result, result_updated_at = NOW() WHERE id = :id`,
        { id: marketId, result: nextResult }
      );
    }

    return {
      reversedWins,
      deducted,
      nextResult,
      bidCount: (bids || []).length,
    };
  });

  await cache.del('markets:v2');

  return {
    ok: true,
    marketId,
    marketName: markets[0].name,
    date,
    session: sess,
    ...out,
  };
}

module.exports = {
  declareMarketResult,
  reverseMarketResult,
};
