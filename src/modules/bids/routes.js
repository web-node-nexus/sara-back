const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const cache = require('../../config/redis');
const { getAppSettings, validateBidsPayload } = require('../../services/appSettings');

const router = express.Router();

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const rows = await query(
      `SELECT id, market_id AS marketId, market_name AS marketName,
              game_id AS gameId, game_name AS gameName,
              number_value AS number, points, session, status,
              created_at AS createdAt
       FROM bids
       WHERE user_id = :userId
         AND (:cursor IS NULL OR id < :cursor)
       ORDER BY id DESC
       LIMIT ${limit}`,
      { userId: req.user.id, cursor }
    );
    res.json({
      ok: true,
      items: rows,
      nextCursor: rows.length ? rows[rows.length - 1].id : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('player'), async (req, res, next) => {
  try {
    const body = z
      .object({
        marketId: z.string().min(1).max(40),
        marketName: z.string().min(1).max(120),
        gameId: z.string().min(1).max(64),
        gameName: z.string().min(1).max(120),
        bids: z
          .array(
            z.object({
              number: z.string().min(1).max(32),
              points: z.number().positive().max(100000),
              session: z.enum(['open', 'close']).optional(),
            })
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);

    const appSettings = await getAppSettings();
    const bidCheck = validateBidsPayload(appSettings, body.bids);
    if (!bidCheck.ok) {
      return res.status(bidCheck.code === 'BIDS_DISABLED' || bidCheck.code === 'GAMES_DISABLED' ? 403 : 400).json({
        ok: false,
        error: bidCheck.code,
        message: bidCheck.message,
      });
    }

    const total = body.bids.reduce((s, b) => s + b.points, 0);

    // Starline: open-only + reject after slot close / inactive
    if (body.marketId.startsWith('starline-')) {
      for (const b of body.bids) {
        if (b.session && b.session !== 'open') {
          return res.status(400).json({
            ok: false,
            error: 'STARLINE_OPEN_ONLY',
            message: 'Starline accepts Open session only',
          });
        }
        b.session = 'open';
      }
      const slots = await query(
        `SELECT close_minutes AS closeMinutes, is_active AS isActive
         FROM starline_slots WHERE id = :id LIMIT 1`,
        { id: body.marketId }
      );
      if (!slots[0] || !slots[0].isActive) {
        return res.status(403).json({
          ok: false,
          error: 'STARLINE_OFF',
          message: 'This Starline game is currently disabled',
        });
      }
      const nowM = new Date().getHours() * 60 + new Date().getMinutes();
      if (nowM >= Number(slots[0].closeMinutes)) {
        return res.status(400).json({
          ok: false,
          error: 'STARLINE_CLOSED',
          message: 'This Starline slot is closed',
        });
      }
    }

    // Jackpot: open-only + reject after slot close / inactive
    if (body.marketId.startsWith('jackpot-')) {
      for (const b of body.bids) {
        if (b.session && b.session !== 'open') {
          return res.status(400).json({
            ok: false,
            error: 'JACKPOT_OPEN_ONLY',
            message: 'Jackpot accepts Open session only',
          });
        }
        b.session = 'open';
      }
      const slots = await query(
        `SELECT close_minutes AS closeMinutes, is_active AS isActive
         FROM jackpot_slots WHERE id = :id LIMIT 1`,
        { id: body.marketId }
      );
      if (!slots[0] || !slots[0].isActive) {
        return res.status(403).json({
          ok: false,
          error: 'JACKPOT_OFF',
          message: 'This Jackpot game is currently disabled',
        });
      }
      const nowM = new Date().getHours() * 60 + new Date().getMinutes();
      if (nowM >= Number(slots[0].closeMinutes)) {
        return res.status(400).json({
          ok: false,
          error: 'JACKPOT_CLOSED',
          message: 'This Jackpot slot is closed',
        });
      }
    }

    const created = await withTransaction(async (conn) => {
      const [wallets] = await conn.execute(
        `SELECT balance FROM wallets WHERE user_id = :userId FOR UPDATE`,
        { userId: req.user.id }
      );
      const wallet = wallets[0];
      if (!wallet || Number(wallet.balance) < total) {
        const err = new Error('Insufficient wallet balance');
        err.status = 400;
        err.code = 'INSUFFICIENT_FUNDS';
        throw err;
      }
      let balance = Number(wallet.balance) - total;
      await conn.execute(
        `UPDATE wallets SET balance = :balance, version = version + 1 WHERE user_id = :userId`,
        { balance, userId: req.user.id }
      );
      await conn.execute(
        `INSERT INTO wallet_ledger
          (user_id, type, amount, balance_after, note, ref_type)
         VALUES (:userId, 'bid', :amount, :balanceAfter, :note, 'bids')`,
        {
          userId: req.user.id,
          amount: total,
          balanceAfter: balance,
          note: `${body.gameName} · ${body.bids.length} bids`,
        }
      );

      const ids = [];
      for (const bid of body.bids) {
        const [r] = await conn.execute(
          `INSERT INTO bids
            (user_id, market_id, market_name, game_id, game_name, number_value, points, session)
           VALUES
            (:userId, :marketId, :marketName, :gameId, :gameName, :number, :points, :session)`,
          {
            userId: req.user.id,
            marketId: body.marketId,
            marketName: body.marketName,
            gameId: body.gameId,
            gameName: body.gameName,
            number: bid.number,
            points: bid.points,
            session: bid.session || null,
          }
        );
        ids.push(r.insertId);
      }
      return { ids, balance, total };
    });

    await cache.del(`wallet:${req.user.id}`);
    res.status(201).json({ ok: true, ...created });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
