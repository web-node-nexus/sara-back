const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const { query } = require('../../config/db');
const { config } = require('../../config/env');
const {
  signAccess,
  signRefresh,
  requireAuth,
} = require('../../middleware/auth');
const {
  sendSmsOtp,
  hashOtp,
  generateOtp,
  normalizePhone,
} = require('./otp');

const router = express.Router();

async function issueTokens(user) {
  const accessToken = signAccess({
    sub: user.id,
    role: user.role,
    loginId: user.login_id,
  });
  const refreshToken = signRefresh({ sub: user.id, role: user.role });
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (:userId, :tokenHash, :expiresAt)`,
    { userId: user.id, tokenHash, expiresAt }
  );
  return { accessToken, refreshToken };
}

function publicUser(user) {
  return {
    id: user.id,
    loginId: user.login_id,
    name: user.name,
    role: user.role,
    phone: user.phone,
  };
}

/** Step 1: number daalo — naya = OTP, purana = password */
router.post('/check-phone', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone || req.body.mobile);
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    }
    const rows = await query(
      `SELECT id, role, status FROM users
       WHERE phone = :phone OR login_id = :phone
       LIMIT 1`,
      { phone }
    );
    const user = rows[0];
    if (!user) {
      return res.json({
        ok: true,
        exists: false,
        next: 'otp',
        purpose: 'signup',
      });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'ACCOUNT_BLOCKED' });
    }
    return res.json({
      ok: true,
      exists: true,
      next: 'password',
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
});

/** OTP bhejo — sirf signup (naya number) ya forgot */
router.post('/send-otp', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: z.string().optional(),
        mobile: z.string().optional(),
        purpose: z.enum(['signup', 'forgot']),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone || body.mobile);
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    }

    const rows = await query(
      `SELECT id FROM users WHERE phone = :phone OR login_id = :phone LIMIT 1`,
      { phone }
    );
    const exists = !!rows[0];

    if (body.purpose === 'signup' && exists) {
      return res.status(409).json({
        ok: false,
        error: 'ALREADY_REGISTERED',
        message: 'Number already registered — password se login karo',
      });
    }
    if (body.purpose === 'forgot' && !exists) {
      return res.status(404).json({
        ok: false,
        error: 'NOT_REGISTERED',
        message: 'Yeh number registered nahi hai',
      });
    }

    const otp = generateOtp();
    const codeHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + config.otp.ttlSeconds * 1000);

    await query(
      `UPDATE otp_codes SET consumed = 1
       WHERE phone = :phone AND purpose = :purpose AND consumed = 0`,
      { phone, purpose: body.purpose }
    );
    await query(
      `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at)
       VALUES (:phone, :purpose, :codeHash, :expiresAt)`,
      { phone, purpose: body.purpose, codeHash, expiresAt }
    );

    const sent = await sendSmsOtp(phone, otp, body.purpose);
    res.json({
      ok: true,
      phone,
      purpose: body.purpose,
      expiresIn: config.otp.ttlSeconds,
      ...(config.otp.mock && config.env !== 'production'
        ? { debugOtp: sent.otp || otp }
        : {}),
    });
  } catch (err) {
    next(err);
  }
});

/** OTP verify → short-lived ticket (set/reset password ke liye) */
router.post('/verify-otp', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: z.string().optional(),
        mobile: z.string().optional(),
        otp: z.string().min(4).max(8),
        purpose: z.enum(['signup', 'forgot']),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone || body.mobile);
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    }

    const rows = await query(
      `SELECT id, code_hash, attempts, expires_at, consumed
       FROM otp_codes
       WHERE phone = :phone AND purpose = :purpose AND consumed = 0
       ORDER BY id DESC LIMIT 1`,
      { phone, purpose: body.purpose }
    );
    const row = rows[0];
    if (!row) {
      return res.status(400).json({ ok: false, error: 'OTP_NOT_FOUND' });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, error: 'OTP_EXPIRED' });
    }
    if (row.attempts >= 5) {
      return res.status(429).json({ ok: false, error: 'OTP_TOO_MANY_ATTEMPTS' });
    }

    const ok = hashOtp(body.otp) === row.code_hash;
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = :id`, {
      id: row.id,
    });
    if (!ok) {
      return res.status(400).json({ ok: false, error: 'OTP_INVALID' });
    }

    await query(`UPDATE otp_codes SET consumed = 1 WHERE id = :id`, {
      id: row.id,
    });

    const ticket = crypto.randomBytes(24).toString('hex');
    const ticketHash = hashOtp(ticket);
    const expiresAt = new Date(
      Date.now() + config.otp.ticketTtlSeconds * 1000
    );
    await query(
      `INSERT INTO otp_tickets (phone, purpose, ticket_hash, expires_at)
       VALUES (:phone, :purpose, :ticketHash, :expiresAt)`,
      { phone, purpose: body.purpose, ticketHash, expiresAt }
    );

    res.json({
      ok: true,
      otpTicket: ticket,
      expiresIn: config.otp.ticketTtlSeconds,
      next: body.purpose === 'signup' ? 'set_password' : 'reset_password',
    });
  } catch (err) {
    next(err);
  }
});

async function consumeTicket(phone, purpose, ticket) {
  const ticketHash = hashOtp(ticket);
  const rows = await query(
    `SELECT id, expires_at, consumed FROM otp_tickets
     WHERE phone = :phone AND purpose = :purpose AND ticket_hash = :ticketHash
     ORDER BY id DESC LIMIT 1`,
    { phone, purpose, ticketHash }
  );
  const row = rows[0];
  if (!row || row.consumed || new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  await query(`UPDATE otp_tickets SET consumed = 1 WHERE id = :id`, {
    id: row.id,
  });
  return row;
}

/** Naya user: OTP ticket ke baad password (+ name) set → login */
router.post('/set-password', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: z.string().optional(),
        mobile: z.string().optional(),
        otpTicket: z.string().min(10),
        password: z.string().min(4).max(72),
        name: z.string().min(1).max(120).optional(),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone || body.mobile);
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    }

    const ticket = await consumeTicket(phone, 'signup', body.otpTicket);
    if (!ticket) {
      return res.status(400).json({ ok: false, error: 'INVALID_TICKET' });
    }

    const existing = await query(
      `SELECT id FROM users WHERE phone = :phone OR login_id = :phone LIMIT 1`,
      { phone }
    );
    if (existing[0]) {
      return res.status(409).json({ ok: false, error: 'ALREADY_REGISTERED' });
    }

    const hash = await bcrypt.hash(body.password, 10);
    const name = (body.name || `Player ${phone.slice(-4)}`).trim();
    const result = await query(
      `INSERT INTO users (login_id, phone, password_hash, name, role)
       VALUES (:loginId, :phone, :hash, :name, 'player')`,
      { loginId: phone, phone, hash, name }
    );
    const userId = result.insertId;
    await query(`INSERT INTO wallets (user_id, balance) VALUES (:userId, 0)`, {
      userId,
    });

    const user = {
      id: userId,
      login_id: phone,
      phone,
      name,
      role: 'player',
    };
    const tokens = await issueTokens(user);
    res.status(201).json({ ok: true, user: publicUser(user), ...tokens });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      err.status = 409;
      err.code = 'ALREADY_REGISTERED';
    }
    next(err);
  }
});

/** Existing user: seedha password login (OTP nahi) */
router.post('/login-password', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: z.string().optional(),
        mobile: z.string().optional(),
        loginId: z.string().optional(),
        password: z.string().min(1),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone || body.mobile || body.loginId);
    const loginId = (body.loginId || phone || '').trim().toLowerCase();
    if (!loginId) {
      return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    }

    const rows = await query(
      `SELECT id, login_id, phone, password_hash, name, role, status
       FROM users
       WHERE login_id = :loginId OR phone = :phone
       LIMIT 1`,
      { loginId, phone: phone || loginId }
    );
    const user = rows[0];
    if (!user || user.status !== 'active') {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    const tokens = await issueTokens(user);
    res.json({ ok: true, user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

/** Forgot: OTP ticket ke baad naya password */
router.post('/reset-password', async (req, res, next) => {
  try {
    const body = z
      .object({
        phone: z.string().optional(),
        mobile: z.string().optional(),
        otpTicket: z.string().min(10),
        password: z.string().min(4).max(72),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone || body.mobile);
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'INVALID_PHONE' });
    }

    const ticket = await consumeTicket(phone, 'forgot', body.otpTicket);
    if (!ticket) {
      return res.status(400).json({ ok: false, error: 'INVALID_TICKET' });
    }

    const rows = await query(
      `SELECT id, login_id, phone, name, role, status
       FROM users WHERE phone = :phone OR login_id = :phone LIMIT 1`,
      { phone }
    );
    const user = rows[0];
    if (!user || user.status !== 'active') {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }

    const hash = await bcrypt.hash(body.password, 10);
    await query(`UPDATE users SET password_hash = :hash WHERE id = :id`, {
      hash,
      id: user.id,
    });
    await query(`DELETE FROM refresh_tokens WHERE user_id = :id`, {
      id: user.id,
    });

    const tokens = await issueTokens(user);
    res.json({ ok: true, user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

/** Legacy login (admin/provider/player) — kept for provider app */
router.post('/login', async (req, res, next) => {
  try {
    const body = z
      .object({ loginId: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);
    const id = body.loginId.trim().toLowerCase();
    const phone = normalizePhone(id);
    const rows = await query(
      `SELECT id, login_id, phone, password_hash, name, role, status
       FROM users WHERE login_id = :id OR phone = :phone LIMIT 1`,
      { id, phone: phone || id }
    );
    const user = rows[0];
    if (!user || user.status !== 'active') {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
    }
    const tokens = await issueTokens(user);
    res.json({ ok: true, user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.body.refreshToken;
    if (!refreshToken) {
      return res.status(400).json({ ok: false, error: 'MISSING_TOKEN' });
    }
    const jwt = require('jsonwebtoken');
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
    }
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    const rows = await query(
      `SELECT id FROM refresh_tokens
       WHERE token_hash = :tokenHash AND user_id = :userId AND expires_at > NOW()
       LIMIT 1`,
      { tokenHash, userId: decoded.sub }
    );
    if (!rows[0]) {
      return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
    }
    const users = await query(
      `SELECT id, login_id, name, role, phone, status FROM users WHERE id = :id LIMIT 1`,
      { id: decoded.sub }
    );
    const user = users[0];
    if (!user || user.status !== 'active') {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }
    const accessToken = signAccess({
      sub: user.id,
      role: user.role,
      loginId: user.login_id,
    });
    res.json({ ok: true, accessToken });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const refreshToken = req.body.refreshToken;
    if (refreshToken) {
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      await query(`DELETE FROM refresh_tokens WHERE token_hash = :tokenHash`, {
        tokenHash,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, login_id AS loginId, name, role, phone, status
       FROM users WHERE id = :id LIMIT 1`,
      { id: req.user.id }
    );
    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
