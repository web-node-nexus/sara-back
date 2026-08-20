const express = require('express');
const { query } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { getAppSettings } = require('../../services/appSettings');
const {
  istDateString,
  istDayBounds,
  toMysqlDatetime,
} = require('../../utils/istDate');

const router = express.Router();

function money(n) {
  const v = Number(n || 0);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function kindSql(alias = 'b') {
  return `CASE
    WHEN ${alias}.market_id LIKE 'starline-%' THEN 'starline'
    WHEN ${alias}.market_id LIKE 'jackpot-%' THEN 'jackpot'
    ELSE 'matka'
  END`;
}

function emptyKind() {
  return { matka: 0, starline: 0, jackpot: 0, total: 0 };
}

function mapKindRows(rows) {
  const out = emptyKind();
  for (const r of rows || []) {
    const k = r.kind === 'starline' || r.kind === 'jackpot' ? r.kind : 'matka';
    out[k] = money(r.amount);
  }
  out.total = money(out.matka + out.starline + out.jackpot);
  return out;
}

function performer(row) {
  return {
    userId: Number(row.userId || 0),
    name: row.name || 'User',
    phone: row.phone || '',
    count: Number(row.cnt || 0),
    amount: money(row.amount),
  };
}

async function bidKindSums(start, end) {
  const dateSql =
    start && end
      ? 'AND b.created_at >= :start AND b.created_at < :end'
      : '';
  const params = start && end ? { start, end } : {};
  const [playRows, winRows] = await Promise.all([
    query(
      `SELECT ${kindSql('b')} AS kind, COALESCE(SUM(b.points), 0) AS amount
       FROM bids b
       WHERE b.status <> 'cancelled' ${dateSql}
       GROUP BY ${kindSql('b')}`,
      params
    ),
    query(
      `SELECT ${kindSql('b')} AS kind, COALESCE(SUM(b.win_amount), 0) AS amount
       FROM bids b
       WHERE b.status <> 'cancelled' ${dateSql}
       GROUP BY ${kindSql('b')}`,
      params
    ),
  ]);
  const play = mapKindRows(playRows);
  const win = mapKindRows(winRows);
  const profit = {
    matka: money(play.matka - win.matka),
    starline: money(play.starline - win.starline),
    jackpot: money(play.jackpot - win.jackpot),
    total: 0,
  };
  profit.total = money(profit.matka + profit.starline + profit.jackpot);
  return { play, win, profit };
}

async function moneyBreakdown(start, end) {
  const dateSql =
    start && end
      ? 'AND l.created_at >= :start AND l.created_at < :end'
      : '';
  const wrDate =
    start && end
      ? 'AND wr.created_at >= :start AND wr.created_at < :end'
      : '';
  const params = start && end ? { start, end } : {};

  const [ledgerRows, wrRows] = await Promise.all([
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN l.type = 'deposit' AND l.ref_type = 'payment_order' THEN l.amount ELSE 0 END), 0) AS gateway,
         COALESCE(SUM(CASE WHEN l.type = 'deposit' AND l.ref_type = 'welcome_bonus' THEN l.amount ELSE 0 END), 0) AS welcome,
         COALESCE(SUM(CASE WHEN l.type = 'deposit' AND (l.ref_type IS NULL OR l.ref_type NOT IN ('welcome_bonus')) THEN l.amount ELSE 0 END), 0) AS deposits,
         COALESCE(SUM(CASE WHEN l.type = 'adjust' AND l.amount > 0 THEN l.amount ELSE 0 END), 0) AS manualCredit,
         COALESCE(SUM(CASE WHEN l.type = 'adjust' AND l.amount < 0 THEN ABS(l.amount) ELSE 0 END), 0) AS manualDebit,
         COALESCE(SUM(CASE WHEN l.type = 'withdraw' THEN l.amount ELSE 0 END), 0) AS ledgerWithdraw
       FROM wallet_ledger l
       WHERE 1=1 ${dateSql}`,
      params
    ),
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN wr.status IN ('pending','processing') THEN wr.amount ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN wr.status IN ('approved','paid') THEN wr.amount ELSE 0 END), 0) AS approved,
         COALESCE(SUM(CASE WHEN wr.status = 'rejected' THEN wr.amount ELSE 0 END), 0) AS rejected
       FROM withdraw_requests wr
       WHERE 1=1 ${wrDate}`,
      params
    ),
  ]);

  const l = ledgerRows[0] || {};
  const w = wrRows[0] || {};
  const gateway = money(l.gateway);
  const manually = money(l.manualCredit);
  const addTotal = money(gateway + manually);
  const pending = money(w.pending);
  const approved = money(w.approved);
  const rejected = money(w.rejected);
  const manualDebit = money(l.manualDebit);
  const withdrawTotal = money(approved + rejected + pending + manualDebit);

  return {
    addMoney: {
      upi: 0,
      gateway,
      gateways: {
        imb: gateway,
        nxt: 0,
        primepay: 0,
        zakopay: 0,
        tpipay: 0,
        webit: 0,
      },
      gatewayManually: 0,
      manually,
      total: addTotal,
    },
    withdraw: {
      approved,
      rejected,
      pending,
      manually: manualDebit,
      total: withdrawTotal,
    },
    rejectMoney: { withdrawRequest: rejected },
    bonus: { welcome: money(l.welcome) },
    pnl: {
      deposits: money(l.deposits),
      withdrawals: money(l.ledgerWithdraw),
      profit: money(Number(l.deposits || 0) - Number(l.ledgerWithdraw || 0)),
    },
  };
}

async function topPerformers(start, end) {
  const dateSql =
    start && end ? 'AND x.created_at >= :start AND x.created_at < :end' : '';
  const params = start && end ? { start, end } : {};

  const [wins, withdrawals, bids] = await Promise.all([
    query(
      `SELECT u.id AS userId, u.name, u.phone,
              COUNT(*) AS cnt, COALESCE(SUM(x.win_amount), 0) AS amount
       FROM bids x
       INNER JOIN users u ON u.id = x.user_id
       WHERE x.status = 'won' AND x.win_amount > 0 ${dateSql}
       GROUP BY u.id, u.name, u.phone
       ORDER BY amount DESC
       LIMIT 5`,
      params
    ),
    query(
      `SELECT u.id AS userId, u.name, u.phone,
              COUNT(*) AS cnt, COALESCE(SUM(x.amount), 0) AS amount
       FROM wallet_ledger x
       INNER JOIN users u ON u.id = x.user_id
       WHERE x.type = 'withdraw' ${dateSql}
       GROUP BY u.id, u.name, u.phone
       ORDER BY amount DESC
       LIMIT 5`,
      params
    ),
    query(
      `SELECT u.id AS userId, u.name, u.phone,
              COUNT(*) AS cnt, COALESCE(SUM(x.points), 0) AS amount
       FROM bids x
       INNER JOIN users u ON u.id = x.user_id
       WHERE x.status <> 'cancelled' ${dateSql}
       GROUP BY u.id, u.name, u.phone
       ORDER BY amount DESC
       LIMIT 5`,
      params
    ),
  ]);

  return {
    wins: (wins || []).map(performer),
    withdrawals: (withdrawals || []).map(performer),
    bids: (bids || []).map(performer),
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const today = istDateString();
    const date = String(req.query.date || today).slice(0, 10);
    const { start, end } = istDayBounds(date);
    const dayStart = toMysqlDatetime(start);
    const dayEnd = toMysqlDatetime(end);
    const todayBounds = istDayBounds(today);
    const todayStart = toMysqlDatetime(todayBounds.start);
    const todayEnd = toMysqlDatetime(todayBounds.end);

    const [
      settings,
      kpiRows,
      scopedBids,
      scopedMoney,
      todayMoney,
      lifetimeMoney,
      top,
    ] = await Promise.all([
      getAppSettings(),
      query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE role = 'player') AS totalUsers,
           (SELECT COALESCE(SUM(w.balance), 0)
              FROM wallets w
              INNER JOIN users u ON u.id = w.user_id AND u.role = 'player') AS totalWallet,
           (SELECT COUNT(*) FROM withdraw_requests
              WHERE status IN ('pending','processing')) AS pendingWithdrawCount`
      ),
      bidKindSums(dayStart, dayEnd),
      moneyBreakdown(dayStart, dayEnd),
      moneyBreakdown(todayStart, todayEnd),
      moneyBreakdown(null, null),
      topPerformers(dayStart, dayEnd),
    ]);

    const kpi = kpiRows[0] || {};

    res.json({
      ok: true,
      date,
      today,
      gameStatus: !!settings.gameStatus,
      kpi: {
        pendingWithdrawCount: Number(kpi.pendingWithdrawCount || 0),
        totalUsers: Number(kpi.totalUsers || 0),
        totalWallet: money(kpi.totalWallet),
      },
      play: scopedBids.play,
      win: scopedBids.win,
      profit: scopedBids.profit,
      addMoney: scopedMoney.addMoney,
      withdraw: scopedMoney.withdraw,
      rejectMoney: scopedMoney.rejectMoney,
      bonus: scopedMoney.bonus,
      pnl: {
        date: scopedMoney.pnl,
        today: todayMoney.pnl,
        lifetime: lifetimeMoney.pnl,
      },
      top,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
