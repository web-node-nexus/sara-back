const express = require('express');
const { z } = require('zod');
const { query } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  istDateString,
  istDayBounds,
  toMysqlDatetime,
} = require('../../utils/istDate');
const { parseMatkaResult } = require('../../utils/matkaResult');

const router = express.Router();

function money(n) {
  return Number(n || 0);
}

const BID_REPORT_TYPES = [
  'Single Digit',
  'Jodi Digit',
  'Single Pana',
  'Double Pana',
  'Triple Pana',
  'Half Sangam',
  'Full Sangam',
];

function formatAmPm(timeStr) {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':').map(Number);
  if (!Number.isFinite(h)) return String(timeStr).slice(0, 5);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = ((h + 11) % 12) + 1;
  return `${String(hr).padStart(2, '0')}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

function displayDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Report Generation board — every matka market (admin + scrape + seed)
 * with open/close result state for the selected IST date.
 */
router.get(
  '/board',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const date = String(req.query.date || istDateString()).slice(0, 10);
      const rows = await query(
        `SELECT m.id, m.name, m.open_time AS openTimeRaw, m.close_time AS closeTimeRaw,
                m.source, m.is_active AS isActive, m.sort_order AS sortOrder,
                md.result, md.result_declared AS resultDeclared
         FROM markets m
         LEFT JOIN market_daily md
           ON md.market_id = m.id AND md.result_date = :date
         WHERE m.id NOT LIKE 'starline-%'
           AND m.id NOT LIKE 'jackpot-%'
         ORDER BY m.open_time ASC, m.name ASC`,
        { date }
      );

      const items = rows.map((r) => {
        const parsed = parseMatkaResult(r.result);
        return {
          id: r.id,
          name: r.name,
          openTime: formatAmPm(r.openTimeRaw),
          closeTime: formatAmPm(r.closeTimeRaw),
          source: r.source,
          play: !!r.isActive,
          result: r.result || null,
          resultDeclared: !!r.resultDeclared,
          openResult: parsed.hasOpen ? parsed.openText || r.result : null,
          closeResult: parsed.hasClose ? parsed.closeText : null,
          hasOpen: parsed.hasOpen,
          hasClose: parsed.hasClose,
        };
      });

      res.json({
        ok: true,
        date,
        dateLabel: displayDate(date),
        items,
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Starline / jackpot report board */
router.get(
  '/starline-board',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const date = String(req.query.date || istDateString()).slice(0, 10);
      const kind = String(req.query.kind || 'starline').toLowerCase();
      const isJackpot = kind === 'jackpot';
      const slotTable = isJackpot ? 'jackpot_slots' : 'starline_slots';

      let rows;
      if (isJackpot) {
        rows = await query(
          `SELECT s.id, s.name, s.time_label AS timeLabel, s.is_active AS isActive,
                  s.sort_order AS sortOrder, s.close_minutes AS closeMinutes,
                  NULL AS result, NULL AS openDigit, NULL AS declaredAt
           FROM ${slotTable} s
           ORDER BY s.sort_order ASC, s.close_minutes ASC`
        );
      } else {
        rows = await query(
          `SELECT s.id, s.name, s.time_label AS timeLabel, s.is_active AS isActive,
                  s.sort_order AS sortOrder, s.close_minutes AS closeMinutes,
                  r.result_display AS result, r.open_digit AS openDigit,
                  r.declared_at AS declaredAt
           FROM starline_slots s
           LEFT JOIN starline_results r
             ON r.slot_id = s.id AND r.result_date = :date
           ORDER BY s.sort_order ASC, s.close_minutes ASC`,
          { date }
        );
      }

      const items = rows.map((r) => ({
        id: r.id,
        name: r.name,
        timeLabel: r.timeLabel,
        play: !!r.isActive,
        result: r.result || null,
        openDigit: r.openDigit != null ? Number(r.openDigit) : null,
        hasResult: !!(r.result && String(r.result).trim()),
        declaredAt: r.declaredAt || null,
      }));

      res.json({
        ok: true,
        kind: isJackpot ? 'jackpot' : 'starline',
        date,
        dateLabel: displayDate(date),
        items,
      });
    } catch (err) {
      next(err);
    }
  }
);

function reportTypeForBid(gameId, gameName) {
  const value = `${gameId || ''} ${gameName || ''}`.toLowerCase();
  if (value.includes('half') && value.includes('sangam')) return 'Half Sangam';
  if (value.includes('full') && value.includes('sangam')) return 'Full Sangam';
  if (value.includes('triple') && (value.includes('pana') || value.includes('panna'))) {
    return 'Triple Pana';
  }
  if (value.includes('double') && (value.includes('pana') || value.includes('panna'))) {
    return 'Double Pana';
  }
  if (value.includes('single') && (value.includes('pana') || value.includes('panna'))) {
    return 'Single Pana';
  }
  if (
    value.includes('jodi') ||
    value.includes('double digit') ||
    value.includes('double-digit')
  ) {
    return 'Jodi Digit';
  }
  if (value.includes('single') && value.includes('digit')) return 'Single Digit';
  return String(gameName || gameId || 'Other');
}

/**
 * Detailed bid report grouped like the admin reference screen.
 * Date boundaries use IST; user search only changes the included user's bids.
 */
router.get(
  '/bids',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          date: z.string().optional(),
          gameType: z.string().optional(),
          marketId: z.string().optional(),
          session: z.enum(['all', 'open', 'close']).optional(),
          search: z.string().optional(),
        })
        .parse(req.query);

      const date = (q.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const startSql = toMysqlDatetime(start);
      const endSql = toMysqlDatetime(end);
      const gameType = String(q.gameType || '').trim();
      const marketId = String(q.marketId || '').trim();
      const session = q.session || 'all';
      const search = String(q.search || '').trim();

      const params = { startSql, endSql, marketId };
      let userFilterSql = '';
      let matchedUsers = [];

      if (search) {
        matchedUsers = await query(
          `SELECT id, name, phone, login_id AS loginId
           FROM users
           WHERE role = 'player'
             AND (
               name LIKE CONCAT('%', :search, '%')
               OR phone LIKE CONCAT('%', :search, '%')
               OR login_id LIKE CONCAT('%', :search, '%')
             )
           ORDER BY name
           LIMIT 50`,
          { search }
        );

        if (!matchedUsers.length) {
          const markets = await query(
            `SELECT id, name FROM markets WHERE is_active = 1
             ORDER BY sort_order, name`
          );
          return res.json({
            ok: true,
            date,
            filters: { gameType, marketId, session, search },
            matchedUsers: [],
            totalBet: 0,
            totalAmount: 0,
            totalWinAmount: 0,
            groups: [],
            gameTypes: BID_REPORT_TYPES,
            markets,
          });
        }

        const userKeys = matchedUsers.map((user, index) => {
          const key = `reportUid${index}`;
          params[key] = user.id;
          return `:${key}`;
        });
        userFilterSql = `AND b.user_id IN (${userKeys.join(',')})`;
      }

      let sessionSql = '';
      if (session === 'open') {
        sessionSql = `AND (b.session = 'open' OR b.session IS NULL)`;
      } else if (session === 'close') {
        sessionSql = `AND b.session = 'close'`;
      }

      const rows = await query(
        `SELECT
           b.market_id AS marketId,
           MAX(b.market_name) AS marketName,
           b.game_id AS gameId,
           MAX(b.game_name) AS gameName,
           COALESCE(b.session, 'open') AS session,
           b.number_value AS number,
           COUNT(*) AS betCount,
           COALESCE(SUM(b.points), 0) AS betAmount,
           COALESCE(SUM(b.win_amount), 0) AS winAmount
         FROM bids b
         WHERE b.created_at >= :startSql
           AND b.created_at < :endSql
           AND (:marketId = '' OR b.market_id = :marketId)
           ${userFilterSql}
           ${sessionSql}
         GROUP BY
           b.market_id, b.game_id, COALESCE(b.session, 'open'), b.number_value
         ORDER BY
           MAX(b.game_name), MAX(b.market_name),
           COALESCE(b.session, 'open'), b.number_value`,
        params
      );

      const groupMap = new Map();
      let totalBet = 0;
      let totalAmount = 0;
      let totalWinAmount = 0;

      for (const row of rows) {
        const type = reportTypeForBid(row.gameId, row.gameName);
        if (gameType && type !== gameType) continue;

        const item = {
          marketId: row.marketId,
          marketName: row.marketName,
          gameId: row.gameId,
          gameName: row.gameName,
          type,
          session: row.session === 'close' ? 'Close' : 'Open',
          number: row.number,
          betCount: Number(row.betCount || 0),
          betAmount: money(row.betAmount),
          winAmount: money(row.winAmount),
        };

        if (!groupMap.has(type)) {
          groupMap.set(type, {
            type,
            totalBet: 0,
            totalAmount: 0,
            totalWinAmount: 0,
            items: [],
          });
        }
        const group = groupMap.get(type);
        group.items.push(item);
        group.totalBet += item.betCount;
        group.totalAmount += item.betAmount;
        group.totalWinAmount += item.winAmount;
        totalBet += item.betCount;
        totalAmount += item.betAmount;
        totalWinAmount += item.winAmount;
      }

      const groups = BID_REPORT_TYPES.map((type) => {
        return (
          groupMap.get(type) || {
            type,
            totalBet: 0,
            totalAmount: 0,
            totalWinAmount: 0,
            items: [],
          }
        );
      });
      for (const [type, group] of groupMap) {
        if (!BID_REPORT_TYPES.includes(type)) groups.push(group);
      }

      const markets = await query(
        `SELECT id, name FROM markets WHERE is_active = 1
         ORDER BY sort_order, name`
      );

      res.json({
        ok: true,
        date,
        filters: { gameType, marketId, session, search },
        matchedUsers,
        totalBet,
        totalAmount,
        totalWinAmount,
        groups,
        gameTypes: BID_REPORT_TYPES,
        markets,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Profit / Loss by market for an IST calendar day.
 *
 * Filters:
 * - date: IST day (bids in that day)
 * - marketId: single market
 * - session: open | close | open-close | all
 * - search: user name / phone / login — only markets where THAT user bid,
 *   amounts = that user's bid/win/pl only
 */
router.get(
  '/profit-loss',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          date: z.string().optional(),
          marketId: z.string().optional(),
          session: z.enum(['all', 'open', 'close', 'open-close']).optional(),
          search: z.string().optional(),
        })
        .parse(req.query);

      const date = (q.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const startSql = toMysqlDatetime(start);
      const endSql = toMysqlDatetime(end);
      const marketId = (q.marketId || '').trim();
      const session = q.session || 'open-close';
      const search = (q.search || '').trim();

      // Resolve users for "Search For a User"
      let matchedUsers = [];
      let userFilterSql = '';
      const params = {
        startSql,
        endSql,
        marketId,
      };

      if (search) {
        matchedUsers = await query(
          `SELECT id, name, phone, login_id AS loginId
           FROM users
           WHERE role = 'player'
             AND (
               name LIKE CONCAT('%', :search, '%')
               OR phone LIKE CONCAT('%', :search, '%')
               OR login_id LIKE CONCAT('%', :search, '%')
             )
           LIMIT 50`,
          { search }
        );

        if (!matchedUsers.length) {
          const markets = await query(
            `SELECT id, name FROM markets WHERE is_active = 1 ORDER BY sort_order, name`
          );
          return res.json({
            ok: true,
            date,
            session,
            search,
            matchedUsers: [],
            items: [],
            totals: { bidAmount: 0, winAmount: 0, pl: 0 },
            markets: markets.map((m) => ({ id: m.id, name: m.name })),
          });
        }

        const keys = matchedUsers.map((u, i) => {
          const k = `uid${i}`;
          params[k] = u.id;
          return `:${k}`;
        });
        userFilterSql = `AND b.user_id IN (${keys.join(',')})`;
      }

      // Session filter — Open / Close amounts separate
      let sessionClause = '';
      if (session === 'open') {
        // Legacy null session treated as open
        sessionClause = `AND (b.session = 'open' OR b.session IS NULL)`;
      } else if (session === 'close') {
        sessionClause = `AND b.session = 'close'`;
      }
      // open-close / all → both sessions combined

      const bidAgg = await query(
        `SELECT
           b.market_id AS marketId,
           MAX(b.market_name) AS marketName,
           COALESCE(SUM(b.points), 0) AS bidAmount,
           COALESCE(SUM(b.win_amount), 0) AS winAmount,
           COUNT(*) AS bidCount
         FROM bids b
         WHERE b.created_at >= :startSql
           AND b.created_at < :endSql
           AND (:marketId = '' OR b.market_id = :marketId)
           ${userFilterSql}
           ${sessionClause}
         GROUP BY b.market_id
         ORDER BY bidAmount DESC, marketName ASC`,
        params
      );

      const dailyMeta = await query(
        `SELECT market_id AS marketId, market_name AS marketName,
                open_time AS openTime, close_time AS closeTime,
                scrape_timing AS scrapeTiming, result,
                result_declared AS resultDeclared
         FROM market_daily
         WHERE result_date = :date`,
        { date }
      );
      const metaById = new Map(dailyMeta.map((d) => [d.marketId, d]));

      let items;

      if (search) {
        // User search: ONLY markets jahan us user ne paisa lagaya
        items = bidAgg.map((b) => {
          const meta = metaById.get(b.marketId);
          const bidAmount = money(b.bidAmount);
          const winAmount = money(b.winAmount);
          return {
            marketId: b.marketId,
            marketName: b.marketName || meta?.marketName || b.marketId,
            bidAmount,
            winAmount,
            pl: bidAmount - winAmount,
            bidCount: Number(b.bidCount || 0),
            openTime: meta?.openTime || null,
            closeTime: meta?.closeTime || null,
            scrapeTiming: meta?.scrapeTiming || null,
            result: meta?.result || null,
            resultDeclared: Number(meta?.resultDeclared) === 1,
          };
        });
      } else {
        // Overview: daily markets + bid totals (zeros allowed)
        const byId = new Map();
        for (const d of dailyMeta) {
          if (marketId && d.marketId !== marketId) continue;
          byId.set(d.marketId, {
            marketId: d.marketId,
            marketName: d.marketName,
            bidAmount: 0,
            winAmount: 0,
            pl: 0,
            bidCount: 0,
            openTime: d.openTime,
            closeTime: d.closeTime,
            scrapeTiming: d.scrapeTiming,
            result: d.result,
            resultDeclared: Number(d.resultDeclared) === 1,
          });
        }
        for (const b of bidAgg) {
          const meta = byId.get(b.marketId) || metaById.get(b.marketId);
          const bidAmount = money(b.bidAmount);
          const winAmount = money(b.winAmount);
          byId.set(b.marketId, {
            marketId: b.marketId,
            marketName:
              b.marketName || meta?.marketName || b.marketId,
            bidAmount,
            winAmount,
            pl: bidAmount - winAmount,
            bidCount: Number(b.bidCount || 0),
            openTime: meta?.openTime || null,
            closeTime: meta?.closeTime || null,
            scrapeTiming: meta?.scrapeTiming || null,
            result: meta?.result || null,
            resultDeclared: Number(meta?.resultDeclared) === 1,
          });
        }
        items = Array.from(byId.values());
        items.sort((a, b) => {
          if (b.bidAmount !== a.bidAmount) return b.bidAmount - a.bidAmount;
          return String(a.marketName).localeCompare(String(b.marketName));
        });
      }

      const totals = items.reduce(
        (acc, it) => {
          acc.bidAmount += it.bidAmount;
          acc.winAmount += it.winAmount;
          acc.pl += it.pl;
          return acc;
        },
        { bidAmount: 0, winAmount: 0, pl: 0 }
      );

      const markets = await query(
        `SELECT id, name FROM markets WHERE is_active = 1 ORDER BY sort_order, name`
      );

      res.json({
        ok: true,
        date,
        session,
        search: search || '',
        dayStart: startSql,
        dayEnd: endSql,
        matchedUsers: matchedUsers.map((u) => ({
          id: u.id,
          name: u.name,
          phone: u.phone,
          loginId: u.loginId,
        })),
        items,
        totals,
        markets: markets.map((m) => ({ id: m.id, name: m.name })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Today's (or date) scraped daily market rows from DB — not live HTML */
router.get(
  '/market-daily',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const date = String(req.query.date || istDateString()).slice(0, 10);
      const marketId = String(req.query.marketId || '').trim();
      const params = { date };
      let where = 'md.result_date = :date';
      if (marketId) {
        where += ' AND md.market_id = :marketId';
        params.marketId = marketId;
      }
      const rows = await query(
        `SELECT md.id, md.market_id AS marketId, md.market_name AS marketName,
                md.result_date AS resultDate, md.open_time AS openTime,
                md.close_time AS closeTime, md.scrape_timing AS scrapeTiming,
                md.result, md.result_declared AS resultDeclared,
                md.first_seen_at AS firstSeenAt, md.last_seen_at AS lastSeenAt,
                md.result_updated_at AS resultUpdatedAt,
                m.source
         FROM market_daily md
         LEFT JOIN markets m ON m.id = md.market_id
         WHERE ${where}
         ORDER BY md.open_time IS NULL, md.open_time, md.market_name`,
        params
      );
      res.json({
        ok: true,
        date,
        items: rows.map((r) => ({
          ...r,
          resultDeclared: Number(r.resultDeclared) === 1,
          source: r.source || 'scrape',
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Market-wise result history (last N days) */
router.get(
  '/results/history',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const marketId = String(req.query.marketId || '').trim();
      const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 180);
      if (!marketId) {
        return res.status(400).json({
          ok: false,
          error: 'MARKET_REQUIRED',
          message: 'marketId is required',
        });
      }
      const rows = await query(
        `SELECT md.market_id AS marketId, md.market_name AS marketName,
                md.result_date AS resultDate, md.open_time AS openTime,
                md.close_time AS closeTime, md.result,
                md.result_declared AS resultDeclared,
                md.result_updated_at AS resultUpdatedAt,
                m.source
         FROM market_daily md
         LEFT JOIN markets m ON m.id = md.market_id
         WHERE md.market_id = :marketId
         ORDER BY md.result_date DESC
         LIMIT ${limit}`,
        { marketId }
      );
      res.json({
        ok: true,
        marketId,
        items: rows.map((r) => ({
          ...r,
          resultDeclared: Number(r.resultDeclared) === 1,
          source: r.source || 'scrape',
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * User Statement / Transaction — search by mobile, filter All|Win|Add|Withdraw|Bid
 */
router.get(
  '/statement',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          phone: z.string().optional(),
          type: z.enum(['all', 'win', 'add', 'withdraw', 'bid']).optional(),
          limit: z.string().optional(),
        })
        .parse(req.query);

      const phone = String(q.phone || '')
        .replace(/\D/g, '')
        .slice(-10);
      const type = q.type || 'all';
      const limit = Math.min(Number(q.limit) || 200, 500);

      if (phone.length !== 10) {
        return res.json({
          ok: true,
          user: null,
          type,
          items: [],
          message: 'Enter 10-digit mobile number',
        });
      }

      const users = await query(
        `SELECT u.id, u.name, u.phone, u.login_id AS loginId, u.status,
                COALESCE(w.balance, 0) AS balance
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         WHERE u.role = 'player'
           AND (
             u.phone LIKE CONCAT('%', :phone)
             OR u.login_id LIKE CONCAT('%', :phone)
           )
         ORDER BY u.id DESC
         LIMIT 1`,
        { phone }
      );
      const user = users[0];
      if (!user) {
        return res.json({
          ok: true,
          user: null,
          type,
          items: [],
          message: 'User nahi mila',
        });
      }

      let typeSql = '';
      if (type === 'win') typeSql = `AND l.type = 'win'`;
      else if (type === 'add') typeSql = `AND l.type IN ('deposit', 'adjust')`;
      else if (type === 'withdraw') typeSql = `AND l.type = 'withdraw'`;
      else if (type === 'bid') typeSql = `AND l.type = 'bid'`;

      const rows = await query(
        `SELECT id, type, amount, balance_after AS balanceAfter,
                note, ref_type AS refType, ref_id AS refId,
                created_at AS createdAt
         FROM wallet_ledger l
         WHERE user_id = :userId
           ${typeSql}
         ORDER BY id DESC
         LIMIT ${limit}`,
        { userId: user.id }
      );

      const items = rows.map((r) => {
        const ledgerType = r.type;
        let tab = 'All';
        if (ledgerType === 'win') tab = 'Win';
        else if (ledgerType === 'deposit' || ledgerType === 'adjust') tab = 'Add';
        else if (ledgerType === 'withdraw') tab = 'Withdraw';
        else if (ledgerType === 'bid') tab = 'Bid';

        const amt = money(r.amount);
        const signed =
          ledgerType === 'withdraw' || ledgerType === 'bid'
            ? -Math.abs(amt)
            : amt;

        return {
          id: r.id,
          type: ledgerType,
          tab,
          amount: amt,
          signedAmount: signed,
          balanceAfter: money(r.balanceAfter),
          note: r.note || '',
          refType: r.refType || null,
          refId: r.refId || null,
          createdAt: r.createdAt,
          title:
            ledgerType === 'win'
              ? 'Win Credit'
              : ledgerType === 'deposit'
                ? 'Deposit'
                : ledgerType === 'adjust'
                  ? 'Admin Adjust'
                  : ledgerType === 'withdraw'
                    ? 'Withdrawal'
                    : ledgerType === 'bid'
                      ? 'Bid Deduct'
                      : ledgerType,
        };
      });

      res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          loginId: user.loginId,
          status: user.status,
          balance: money(user.balance),
        },
        type,
        items,
        total: items.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Bid / Win History — filterable bid records with status
 */
router.get(
  '/win-history',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          date: z.string().optional(),
          marketId: z.string().optional(),
          gameType: z.string().optional(),
          session: z.enum(['all', 'open', 'close', 'both']).optional(),
          status: z
            .enum(['all', 'won', 'lost', 'pending', 'cancelled'])
            .optional(),
          searchUser: z.string().optional(),
          searchNumber: z.string().optional(),
          limit: z.string().optional(),
        })
        .parse(req.query);

      const date = (q.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const startSql = toMysqlDatetime(start);
      const endSql = toMysqlDatetime(end);
      const marketId = String(q.marketId || '').trim();
      const gameType = String(q.gameType || '').trim();
      const session = q.session === 'both' ? 'all' : q.session || 'all';
      const status = q.status || 'all';
      const searchUser = String(q.searchUser || '').trim();
      const searchNumber = String(q.searchNumber || '').trim();
      const limit = Math.min(Number(q.limit) || 300, 500);

      const params = { startSql, endSql, marketId, searchNumber };
      let userSql = '';
      let sessionSql = '';
      let statusSql = '';

      if (searchUser) {
        const matched = await query(
          `SELECT id FROM users
           WHERE role = 'player'
             AND (
               name LIKE CONCAT('%', :searchUser, '%')
               OR phone LIKE CONCAT('%', :searchUser, '%')
               OR login_id LIKE CONCAT('%', :searchUser, '%')
             )
           LIMIT 50`,
          { searchUser }
        );
        if (!matched.length) {
          const markets = await query(
            `SELECT id, name FROM markets WHERE is_active = 1
             ORDER BY sort_order, name`
          );
          return res.json({
            ok: true,
            date,
            total: 0,
            items: [],
            markets,
            gameTypes: BID_REPORT_TYPES,
            filters: {
              marketId,
              gameType,
              session,
              status,
              searchUser,
              searchNumber,
            },
          });
        }
        const keys = matched.map((u, i) => {
          const k = `whUid${i}`;
          params[k] = u.id;
          return `:${k}`;
        });
        userSql = `AND b.user_id IN (${keys.join(',')})`;
      }

      if (session === 'open') {
        sessionSql = `AND (b.session = 'open' OR b.session IS NULL)`;
      } else if (session === 'close') {
        sessionSql = `AND b.session = 'close'`;
      }

      if (status !== 'all') {
        statusSql = `AND b.status = :status`;
        params.status = status;
      }

      const rows = await query(
        `SELECT
           b.id,
           b.user_id AS userId,
           u.name AS userName,
           u.phone AS userPhone,
           b.market_id AS marketId,
           b.market_name AS marketName,
           b.game_id AS gameId,
           b.game_name AS gameName,
           b.number_value AS number,
           b.points,
           COALESCE(b.win_amount, 0) AS winAmount,
           COALESCE(b.session, 'open') AS session,
           b.status,
           b.created_at AS createdAt
         FROM bids b
         LEFT JOIN users u ON u.id = b.user_id
         WHERE b.created_at >= :startSql
           AND b.created_at < :endSql
           AND (:marketId = '' OR b.market_id = :marketId)
           AND (:searchNumber = '' OR b.number_value LIKE CONCAT('%', :searchNumber, '%'))
           ${userSql}
           ${sessionSql}
           ${statusSql}
         ORDER BY b.id DESC
         LIMIT ${limit}`,
        params
      );

      const items = [];
      for (const r of rows) {
        const type = reportTypeForBid(r.gameId, r.gameName);
        if (gameType && type !== gameType) continue;
        items.push({
          id: r.id,
          userId: r.userId,
          userName: r.userName || '—',
          userPhone: r.userPhone || '',
          marketId: r.marketId,
          marketName: r.marketName,
          gameId: r.gameId,
          gameName: r.gameName,
          type,
          number: r.number,
          points: money(r.points),
          winAmount: money(r.winAmount),
          session: r.session === 'close' ? 'Close' : 'Open',
          status: r.status,
          createdAt: r.createdAt,
        });
      }

      const markets = await query(
        `SELECT id, name FROM markets WHERE is_active = 1
         ORDER BY sort_order, name`
      );

      res.json({
        ok: true,
        date,
        total: items.length,
        items,
        markets,
        gameTypes: BID_REPORT_TYPES,
        filters: {
          marketId,
          gameType,
          session,
          status,
          searchUser,
          searchNumber,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Play card — matka bids and wins by game type for one IST day.
 * Amount is points; the count in parentheses is the number of bids / winning bids.
 */
router.get(
  '/play-card',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          date: z.string().optional(),
          gameType: z.string().optional(),
          marketId: z.string().optional(),
          session: z.enum(['both', 'open', 'close', 'all']).optional(),
        })
        .parse(req.query);

      const date = (q.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const marketId = String(q.marketId || '').trim();
      const session = !q.session || q.session === 'all' ? 'both' : q.session;
      const gameType = String(q.gameType || '').trim();
      const typeFilter =
        gameType && gameType.toLowerCase() !== 'all' ? gameType : '';

      let sessionSql = '';
      if (session === 'open') {
        sessionSql = `AND (b.session = 'open' OR b.session IS NULL)`;
      } else if (session === 'close') {
        sessionSql = `AND b.session = 'close'`;
      }

      const rows = await query(
        `SELECT b.game_id AS gameId,
                MAX(b.game_name) AS gameName,
                COUNT(*) AS bidCount,
                COALESCE(SUM(b.points), 0) AS bidAmount,
                COALESCE(SUM(CASE WHEN b.win_amount > 0 THEN 1 ELSE 0 END), 0) AS winCount,
                COALESCE(SUM(b.win_amount), 0) AS winAmount
         FROM bids b
         WHERE b.status <> 'cancelled'
           AND b.created_at >= :startSql
           AND b.created_at < :endSql
           AND b.market_id NOT LIKE 'starline-%'
           AND b.market_id NOT LIKE 'jackpot-%'
           AND (:marketId = '' OR b.market_id = :marketId)
           ${sessionSql}
         GROUP BY b.game_id`,
        {
          startSql: toMysqlDatetime(start),
          endSql: toMysqlDatetime(end),
          marketId,
        }
      );

      const buckets = new Map();
      for (const type of BID_REPORT_TYPES) {
        buckets.set(type, {
          type,
          bidAmount: 0,
          bidCount: 0,
          winAmount: 0,
          winCount: 0,
        });
      }
      for (const row of rows) {
        const type = reportTypeForBid(row.gameId, row.gameName);
        if (typeFilter && type !== typeFilter) continue;
        if (!buckets.has(type)) {
          buckets.set(type, {
            type,
            bidAmount: 0,
            bidCount: 0,
            winAmount: 0,
            winCount: 0,
          });
        }
        const bucket = buckets.get(type);
        bucket.bidAmount = money(bucket.bidAmount + money(row.bidAmount));
        bucket.bidCount += Number(row.bidCount || 0);
        bucket.winAmount = money(bucket.winAmount + money(row.winAmount));
        bucket.winCount += Number(row.winCount || 0);
      }

      const items = BID_REPORT_TYPES.map((type) => buckets.get(type));
      for (const [type, bucket] of buckets) {
        if (!BID_REPORT_TYPES.includes(type)) items.push(bucket);
      }
      const total = items.reduce(
        (sum, row) => ({
          bidAmount: money(sum.bidAmount + row.bidAmount),
          bidCount: sum.bidCount + row.bidCount,
          winAmount: money(sum.winAmount + row.winAmount),
          winCount: sum.winCount + row.winCount,
        }),
        { bidAmount: 0, bidCount: 0, winAmount: 0, winCount: 0 }
      );

      const markets = await query(
        `SELECT id, name FROM markets
         WHERE id NOT LIKE 'starline-%' AND id NOT LIKE 'jackpot-%'
         ORDER BY sort_order, name`
      );

      res.json({
        ok: true,
        date,
        session,
        gameType: typeFilter || 'all',
        marketId,
        items,
        total,
        markets,
        gameTypes: BID_REPORT_TYPES,
      });
    } catch (err) {
      next(err);
    }
  }
);

const ADD_MONEY_TYPES = [
  'all',
  'upi',
  'gateway',
  'nxt',
  'primepay',
  'zakopay',
  'imb',
  'tpipay',
  'webit',
  'manually',
];

const GATEWAY_CHANNELS = ['nxt', 'primepay', 'zakopay', 'imb', 'tpipay', 'webit'];

function addMoneyChannel(row) {
  const ref = String(row.refType || '').toLowerCase();
  const note = String(row.note || '').toLowerCase();
  if (row.type === 'adjust') return 'manually';
  if (ref === 'upi' || ref === 'upi_deposit') return 'upi';
  if (ref === 'payment_order' || note.includes('imb')) return 'imb';
  if (note.includes('nxt')) return 'nxt';
  if (note.includes('primexpay') || note.includes('primepay')) return 'primepay';
  if (note.includes('zakopay')) return 'zakopay';
  if (note.includes('tpipay')) return 'tpipay';
  if (note.includes('webit')) return 'webit';
  if (row.type === 'deposit') return 'imb';
  return 'manually';
}

function emptyAddSummary() {
  return {
    upi: 0,
    manually: 0,
    gateway: 0,
    gatewayManually: 0,
    gateways: {
      nxt: 0,
      primepay: 0,
      zakopay: 0,
      imb: 0,
      tpipay: 0,
      webit: 0,
    },
    total: 0,
  };
}

/**
 * Credits added to wallets on an IST day.
 * Gateway = IMB payment orders. Manually = admin credit.
 * Welcome bonus is excluded; it stays on the bonus card.
 */
router.get(
  '/add-money',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          date: z.string().optional(),
          type: z.string().optional(),
          mobile: z.string().optional(),
        })
        .parse(req.query);

      const date = (q.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const type = ADD_MONEY_TYPES.includes(String(q.type || 'all'))
        ? String(q.type || 'all')
        : 'all';
      const mobile = String(q.mobile || '').replace(/\D/g, '').slice(0, 15);

      const rows = await query(
        `SELECT l.id, l.user_id AS userId, u.name, u.phone,
                l.type, l.amount, l.balance_after AS balanceAfter,
                l.note, l.ref_type AS refType, l.ref_id AS refId,
                l.created_at AS createdAt
         FROM wallet_ledger l
         JOIN users u ON u.id = l.user_id
         WHERE l.created_at >= :startSql
           AND l.created_at < :endSql
           AND (
             (l.type = 'deposit' AND (l.ref_type IS NULL OR l.ref_type <> 'welcome_bonus'))
             OR (l.type = 'adjust' AND l.amount > 0)
           )
           AND (:mobile = '' OR u.phone LIKE CONCAT('%', :mobile, '%'))
         ORDER BY l.id DESC
         LIMIT 400`,
        {
          startSql: toMysqlDatetime(start),
          endSql: toMysqlDatetime(end),
          mobile,
        }
      );

      const summary = emptyAddSummary();
      const classified = rows.map((row) => {
        const amount = money(row.amount);
        const channel = addMoneyChannel(row);
        if (channel === 'upi') summary.upi = money(summary.upi + amount);
        else if (channel === 'manually') {
          summary.manually = money(summary.manually + amount);
        } else if (GATEWAY_CHANNELS.includes(channel)) {
          summary.gateways[channel] = money(summary.gateways[channel] + amount);
          summary.gateway = money(summary.gateway + amount);
        }
        return {
          id: row.id,
          userId: row.userId,
          name: row.name || 'User',
          phone: row.phone || '',
          amount,
          balanceAfter: money(row.balanceAfter),
          note: row.note || '',
          channel,
          createdAt: row.createdAt,
        };
      });

      summary.total = money(
        summary.upi + summary.manually + summary.gateway + summary.gatewayManually
      );

      const items =
        type === 'all'
          ? classified
          : type === 'gateway'
            ? classified.filter((row) => GATEWAY_CHANNELS.includes(row.channel))
            : classified.filter((row) => row.channel === type);

      res.json({
        ok: true,
        date,
        type,
        mobile,
        records: items.length,
        summary,
        items,
      });
    } catch (err) {
      next(err);
    }
  }
);

const WITHDRAW_TYPES = [
  'all',
  'auto',
  'manual',
  'nxt',
  'primepay',
  'zakopay',
  'imb',
  'tpipay',
];

function withdrawChannel(row) {
  const payout = String(row.payoutStatus || '');
  if (payout.toLowerCase() === 'manual') return 'manual';
  const note = `${row.note || ''} ${row.bankName || ''}`.toLowerCase();
  if (note.includes('nxt')) return 'nxt';
  if (note.includes('primexpay') || note.includes('primepay')) return 'primepay';
  if (note.includes('zakopay')) return 'zakopay';
  if (note.includes('tpipay')) return 'tpipay';
  return 'imb';
}

/**
 * Approved / paid withdrawals for an IST day.
 * Manual = Accept With Bank. Auto = gateway payout. Live gateway is IMB.
 */
router.get(
  '/withdraw-money',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          date: z.string().optional(),
          type: z.string().optional(),
          mobile: z.string().optional(),
        })
        .parse(req.query);

      const date = (q.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const type = WITHDRAW_TYPES.includes(String(q.type || 'all'))
        ? String(q.type || 'all')
        : 'all';
      const mobile = String(q.mobile || '').replace(/\D/g, '').slice(0, 15);

      const rows = await query(
        `SELECT w.id, w.user_id AS userId, u.name, u.phone, w.amount, w.status,
                w.note, w.payout_status AS payoutStatus, w.payout_txn_id AS payoutTxnId,
                w.bank_name AS bankName, w.upi_id AS upiId,
                w.account_name AS accountName, w.created_at AS createdAt
         FROM withdraw_requests w
         JOIN users u ON u.id = w.user_id
         WHERE w.status IN ('approved', 'paid')
           AND w.created_at >= :startSql
           AND w.created_at < :endSql
           AND (:mobile = '' OR u.phone LIKE CONCAT('%', :mobile, '%'))
         ORDER BY w.id DESC
         LIMIT 400`,
        {
          startSql: toMysqlDatetime(start),
          endSql: toMysqlDatetime(end),
          mobile,
        }
      );

      const summary = {
        approved: 0,
        approvedCount: 0,
        auto: 0,
        autoCount: 0,
        manual: 0,
        manualCount: 0,
        gateways: { nxt: 0, primepay: 0, zakopay: 0, imb: 0, tpipay: 0 },
      };

      const classified = rows.map((row) => {
        const amount = money(row.amount);
        const channel = withdrawChannel(row);
        const mode = channel === 'manual' ? 'manual' : 'auto';
        summary.approved = money(summary.approved + amount);
        summary.approvedCount += 1;
        if (mode === 'manual') {
          summary.manual = money(summary.manual + amount);
          summary.manualCount += 1;
        } else {
          summary.auto = money(summary.auto + amount);
          summary.autoCount += 1;
          if (summary.gateways[channel] != null) {
            summary.gateways[channel] = money(summary.gateways[channel] + amount);
          }
        }
        return {
          id: row.id,
          userId: row.userId,
          name: row.name || 'User',
          phone: row.phone || '',
          amount,
          status: row.status,
          mode,
          channel,
          note: row.note || '',
          upiId: row.upiId || null,
          accountName: row.accountName || null,
          bankName: row.bankName || null,
          payoutTxnId: row.payoutTxnId || null,
          createdAt: row.createdAt,
        };
      });

      const items = classified.filter((row) => {
        if (type === 'all') return true;
        if (type === 'auto') return row.mode === 'auto';
        if (type === 'manual') return row.mode === 'manual';
        return row.channel === type;
      });

      res.json({
        ok: true,
        date,
        type,
        mobile,
        status: 'approved',
        records: items.length,
        summary,
        items,
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Rejected withdraw requests for an IST day. Amount was refunded to the wallet. */
router.get(
  '/rejected-money',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const date = String(req.query.date || istDateString()).slice(0, 10);
      const { start, end } = istDayBounds(date);
      const rows = await query(
        `SELECT w.id, w.user_id AS userId, u.name, u.phone, w.amount,
                w.note, w.upi_id AS upiId, w.account_name AS accountName,
                w.bank_name AS bankName, w.created_at AS createdAt
         FROM withdraw_requests w
         JOIN users u ON u.id = w.user_id
         WHERE w.status = 'rejected'
           AND w.created_at >= :startSql
           AND w.created_at < :endSql
         ORDER BY w.id DESC
         LIMIT 400`,
        {
          startSql: toMysqlDatetime(start),
          endSql: toMysqlDatetime(end),
        }
      );
      const items = rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name || 'User',
        phone: row.phone || '',
        amount: money(row.amount),
        note: row.note || '',
        upiId: row.upiId || null,
        accountName: row.accountName || null,
        bankName: row.bankName || null,
        createdAt: row.createdAt,
      }));
      const total = items.reduce((sum, row) => money(sum + row.amount), 0);
      res.json({ ok: true, date, total, records: items.length, items });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
