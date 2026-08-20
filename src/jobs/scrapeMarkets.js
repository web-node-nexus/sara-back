/**
 * Market scraper job
 *
 * - Updates live result/timing on matching DB markets (seed + admin kept as-is)
 * - Inserts NEW scrape-only markets as OFF (admin must enable Game On/Off)
 * - Never overwrites admin play ON/OFF on existing scrape rows
 * - User home shows only is_active=1 markets
 *
 * Target URL: env SCRAPE_URL
 */

const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { query } = require('../config/db');
const cache = require('../config/redis');
const { config } = require('../config/env');
const { upsertMarketDaily } = require('../services/marketDaily');
const { istDateString } = require('../utils/istDate');
const {
  notifyResultToAllPlayersAsync,
  detectResultKind,
} = require('../services/pushNotifications');
const {
  getAppSettings,
  canAutoResultForMarket,
} = require('../services/appSettings');

/** Optional preferred ids for known names */
const MARKET_ID_MAP = {
  'milan morning': 'milan-morning',
  'kalyan morning': 'kalyan-morning',
  sridevi: 'sridevi',
  'madhur morning': 'madhur-morning',
  'time bazar': 'time-bazar',
  'madhur day': 'madhur-day',
  'milan day': 'milan-day',
  'rajdhani day': 'rajdhani-day',
  'supreme day': 'supreme-day',
  'supreme bazar day': 'supreme-day',
  kalyan: 'kalyan',
  'sridevi night': 'sridevi-night',
  'madhur night': 'madhur-night',
  'supreme night': 'supreme-night',
  'supreme bazar night': 'supreme-night',
  'milan night': 'milan-night',
  'kalyan night': 'kalyan-night',
  'rajdhani night': 'rajdhani-night',
  'main bazar': 'main-bazar',
  'lucknow morning': 'lucknow-morning',
  'ratan day': 'ratan-day',
  'ratan khatri': 'ratan-day',
  ratan: 'ratan-day',
  'worli mumbai night': 'worli-mumbai-night',
  'time night': 'time-night',
  'night time bazar': 'time-night',
  'time bazar night': 'time-night',
  'kalyan evening': 'kalyan-evening',
  'rajdhani morning': 'rajdhani-day',
  'rajdhani morning main': 'rajdhani-day',
};

function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(name) {
  const s = normalize(name).replace(/\s+/g, '-').replace(/-+/g, '-');
  return (s || `m-${Date.now()}`).slice(0, 40);
}

function resolveMarketId(scrapedName) {
  const key = normalize(scrapedName);
  return MARKET_ID_MAP[key] || slugify(scrapedName);
}

/** Parse "10:00 AM" / "22:30" → { h, m } */
function parseClockToken(token) {
  const t = String(token || '').trim();
  const m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (/pm/i.test(m12[3])) h += 12;
    return { h, m: Number(m12[2]) };
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return { h: Number(m24[1]) % 24, m: Number(m24[2]) };
  return null;
}

function toSqlTime(clock) {
  if (!clock) return null;
  return `${String(clock.h).padStart(2, '0')}:${String(clock.m).padStart(2, '0')}:00`;
}

/**
 * Extract open/close from scrape timing text, e.g.
 * "Open : 10:00 AM Close : 11:30 AM"
 */
function parseOpenClose(timing) {
  const text = String(timing || '');
  const times = [];
  const re = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const c = parseClockToken(m[1]);
    if (c) times.push(c);
  }
  if (times.length >= 2) {
    return {
      openTime: toSqlTime(times[0]),
      closeTime: toSqlTime(times[1]),
    };
  }
  return { openTime: null, closeTime: null };
}

function extractWithCheerio(html) {
  const $ = cheerio.load(html);
  const markets = [];

  $('.tkt-val')
    .children('div')
    .each((_, el) => {
      const $el = $(el);
      const market =
        $el.children('h4').first().text().trim() ||
        $el.find('h4').first().text().trim();
      const result =
        $el.children('span').first().text().trim() ||
        $el.find('span').first().text().trim();
      const timing = (
        $el.children('p').first().text() ||
        $el.find('p').first().text() ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      if (market && result) {
        markets.push({ market, result, timing: timing || null });
      }
    });

  return markets;
}

function extractWithRegex(html) {
  const markets = [];
  const blockRe =
    /<h4[^>]*>([^<]+)<\/h4>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>\s*(?:<p[^>]*>\s*([\s\S]*?)\s*<\/p>)?/gi;

  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const market = m[1].replace(/\s+/g, ' ').trim();
    const result = m[2].replace(/\s+/g, ' ').trim();
    const timing = m[3]
      ? m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : null;

    if (!market || !result) continue;
    if (/^\d/.test(result) || /loading/i.test(result) || /\*/.test(result)) {
      markets.push({ market, result, timing });
    }
  }

  return markets;
}

async function scrapeAndStore() {
  const url = config.scrapeUrl;
  if (!url) {
    console.warn('[scraper] SCRAPE_URL not set — skipping run');
    return;
  }

  let html;
  try {
    const { data, status } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'text',
      transformResponse: [(d) => d],
    });

    if (typeof data !== 'string' || data.length < 500) {
      throw new Error(`Unexpected response (status ${status}, len ${data?.length})`);
    }

    if (/just a moment|cf-browser-verification|attention required/i.test(data)) {
      throw new Error('Blocked by Cloudflare — try puppeteer fallback or different URL');
    }

    html = data;
  } catch (err) {
    console.error('[scraper] Fetch failed:', err.message);
    return;
  }

  let rows = extractWithCheerio(html);
  if (!rows.length) rows = extractWithRegex(html);

  const seen = new Set();
  rows = rows.filter((r) => {
    const k = normalize(r.market);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!rows.length) {
    console.warn('[scraper] No market rows found in HTML');
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const scrapedIds = [];
  let upserted = 0;
  let dailyUpserts = 0;
  const todayIst = istDateString();
  const appSettings = await getAppSettings();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = resolveMarketId(row.market);
    scrapedIds.push(id);

    const resultVal = (row.result || '').trim() || null;
    const allowAutoResult = canAutoResultForMarket(appSettings, row.market, id);
    const effectiveResult = allowAutoResult ? resultVal : null;
    const { openTime, closeTime } = parseOpenClose(row.timing);
    const openSql = openTime || '10:00:00';
    const closeSql = closeTime || '23:00:00';

    try {
      const existing = await query(
        `SELECT source FROM markets WHERE id = :id LIMIT 1`,
        { id }
      );
      const src = existing[0]?.source;

      // Admin-created games: never auto-declare / overwrite from scrape
      if (src === 'admin') {
        upserted++;
        continue;
      }

      // Always persist today's IST daily snapshot (no duplicate rows)
      const dailyOut = await upsertMarketDaily({
        marketId: id,
        marketName: row.market.trim(),
        openTime: openTime || null,
        closeTime: closeTime || null,
        scrapeTiming: row.timing || null,
        result: effectiveResult,
      });
      dailyUpserts++;

      // New / changed declared result → push to all players
      if (dailyOut?.shouldNotify && dailyOut.result) {
        notifyResultToAllPlayersAsync({
          kind: detectResultKind({
            marketId: id,
            marketName: row.market.trim(),
          }),
          marketId: id,
          marketName: row.market.trim(),
          result: dailyOut.result,
          resultDate: dailyOut.resultDate || todayIst,
        });
      }

      // Seed markets: refresh live result only — keep source & schedule
      if (src === 'seed') {
        if (effectiveResult || row.timing) {
          await query(
            `UPDATE markets
             SET result = COALESCE(:result, result),
                 scrape_timing = COALESCE(:timing, scrape_timing),
                 result_updated_at = IF(:result IS NOT NULL, :now, result_updated_at),
                 open_time = IF(:hasTimes = 1, :openTime, open_time),
                 close_time = IF(:hasTimes = 1, :closeTime, close_time)
               WHERE id = :id AND source = 'seed'`,
            {
              id,
              result: effectiveResult,
              timing: row.timing || null,
              now,
              openTime: openSql,
              closeTime: closeSql,
              hasTimes: openTime && closeTime ? 1 : 0,
            }
          );
        }
        upserted++;
        continue;
      }

      // New scrape games stay OFF until admin enables them in Game On/Off.
      // Existing rows keep whatever play flag the admin set.
      await query(
        `INSERT INTO markets
          (id, name, open_time, close_time, is_active, source, sort_order,
           result, scrape_timing, result_updated_at)
         VALUES
          (:id, :name, :openTime, :closeTime, 0, 'scrape', :sort,
           :result, :timing, :now)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           source = 'scrape',
           sort_order = VALUES(sort_order),
           result = VALUES(result),
           scrape_timing = VALUES(scrape_timing),
           result_updated_at = VALUES(result_updated_at),
           open_time = IF(:hasTimes = 1, VALUES(open_time), open_time),
           close_time = IF(:hasTimes = 1, VALUES(close_time), close_time)`,
        {
          id,
          name: row.market.trim(),
          openTime: openSql,
          closeTime: closeSql,
          sort: i + 1,
          result: effectiveResult,
          timing: row.timing || null,
          now,
          hasTimes: openTime && closeTime ? 1 : 0,
        }
      );
      upserted++;
    } catch (dbErr) {
      console.error(`[scraper] Upsert failed for ${id}:`, dbErr.message);
    }
  }

  await cache.del('markets:v2');

  console.log(
    `[scraper] Done — markets ${upserted}/${rows.length}, daily ${dailyUpserts} (${todayIst}) @ ${now}`
  );
}

function startScrapeJob() {
  scrapeAndStore().catch((err) =>
    console.error('[scraper] Initial run failed:', err.message)
  );

  cron.schedule('*/2 * * * *', () => {
    scrapeAndStore().catch((err) =>
      console.error('[scraper] Scheduled run failed:', err.message)
    );
  });

  console.log('[scraper] Scheduled: every 2 minutes (markets from scrape)');
}

module.exports = { startScrapeJob, scrapeAndStore };
