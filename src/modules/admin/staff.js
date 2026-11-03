const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  ADMIN_SCREENS,
  ADMIN_SCREEN_KEYS,
  normalizeScreens,
} = require('./adminScreens');

const router = express.Router();

async function loadScreens(userId) {
  const rows = await query(
    `SELECT screen_key AS screenKey FROM admin_user_screens WHERE user_id = :userId`,
    { userId }
  );
  return (rows || []).map((r) => r.screenKey);
}

async function getAdminRow(id) {
  const rows = await query(
    `SELECT id, login_id AS loginId, name, role, status,
            COALESCE(is_superadmin, 0) AS isSuperadmin,
            created_at AS createdAt
     FROM users
     WHERE id = :id AND role = 'admin'
     LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function requireStaffManager(req, res) {
  const me = await getAdminRow(req.user.id);
  if (!me) {
    res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Admin only' });
    return null;
  }
  if (Number(me.isSuperadmin)) return { ...me, screens: ADMIN_SCREEN_KEYS };
  const screens = await loadScreens(me.id);
  if (!screens.includes('createUser')) {
    res.status(403).json({
      ok: false,
      error: 'FORBIDDEN',
      message: 'Add Users access required',
    });
    return null;
  }
  return { ...me, screens };
}

function mapStaff(row, screens) {
  const isSuper = !!Number(row.isSuperadmin);
  const screenList = isSuper ? ADMIN_SCREEN_KEYS : screens || [];
  return {
    id: Number(row.id),
    loginId: row.loginId,
    name: row.name,
    status: row.status,
    isSuperadmin: isSuper,
    screens: screenList,
    screenCount: screenList.length,
    createdAt: row.createdAt,
  };
}

router.get('/screens', requireAuth, requireRole('admin'), async (_req, res) => {
  res.json({ ok: true, items: ADMIN_SCREENS });
});

router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const me = await requireStaffManager(req, res);
    if (!me) return;
    const q = String(req.query.q || '').trim();
    const rows = await query(
      `SELECT id, login_id AS loginId, name, role, status,
              COALESCE(is_superadmin, 0) AS isSuperadmin,
              created_at AS createdAt
       FROM users
       WHERE role = 'admin'
         AND (
           :q = ''
           OR login_id LIKE CONCAT('%', :q, '%')
           OR name LIKE CONCAT('%', :q, '%')
         )
       ORDER BY is_superadmin DESC, id ASC`,
      { q }
    );
    const items = [];
    for (const row of rows) {
      const screens = Number(row.isSuperadmin)
        ? ADMIN_SCREEN_KEYS
        : await loadScreens(row.id);
      items.push(mapStaff(row, screens));
    }
    res.json({ ok: true, items, meId: me.id });
  } catch (err) {
    next(err);
  }
});

router.get('/online', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const me = await requireStaffManager(req, res);
    if (!me) return;
    const rows = await query(
      `SELECT rt.id, rt.user_id AS userId, u.login_id AS loginId, u.name,
              COALESCE(u.is_superadmin, 0) AS isSuperadmin,
              rt.created_at AS startedAt, rt.expires_at AS expiresAt
       FROM refresh_tokens rt
       INNER JOIN users u ON u.id = rt.user_id AND u.role = 'admin'
       WHERE rt.expires_at > NOW()
       ORDER BY rt.created_at DESC
       LIMIT 200`
    );
    const items = (rows || []).map((row) => ({
      id: Number(row.id),
      userId: Number(row.userId),
      loginId: row.loginId,
      name: row.name,
      isSuperadmin: !!Number(row.isSuperadmin),
      isYou: Number(row.userId) === Number(me.id),
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
    }));
    res.json({ ok: true, count: items.length, items });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const me = await requireStaffManager(req, res);
    if (!me) return;
    const body = z
      .object({
        loginId: z.string().min(3).max(64),
        password: z.string().min(4).max(72),
        name: z.string().min(2).max(120),
        screens: z.array(z.string()).default([]),
      })
      .parse(req.body);

    const loginId = body.loginId.trim().toLowerCase();
    const name = body.name.trim();
    const screens = normalizeScreens(body.screens);
    if (!/^[a-z0-9._-]+$/i.test(loginId)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_USERNAME',
        message: 'Username: letters, numbers, . _ - only',
      });
    }
    if (!screens.length) {
      return res.status(400).json({
        ok: false,
        error: 'SCREENS_REQUIRED',
        message: 'Select at least one screen',
      });
    }

    const hash = await bcrypt.hash(body.password, 10);
    const created = await withTransaction(async (conn) => {
      const [dup] = await conn.execute(
        `SELECT id FROM users WHERE login_id = ? LIMIT 1`,
        [loginId]
      );
      if (dup[0]) {
        const err = new Error('Username already taken');
        err.status = 409;
        err.code = 'USERNAME_TAKEN';
        throw err;
      }
      const [result] = await conn.execute(
        `INSERT INTO users (login_id, phone, password_hash, name, role, status, is_superadmin)
         VALUES (?, NULL, ?, ?, 'admin', 'active', 0)`,
        [loginId, hash, name]
      );
      const userId = result.insertId;
      for (const key of screens) {
        await conn.execute(
          `INSERT INTO admin_user_screens (user_id, screen_key) VALUES (?, ?)`,
          [userId, key]
        );
      }
      return userId;
    });

    const row = await getAdminRow(created);
    res.status(201).json({ ok: true, user: mapStaff(row, screens) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const me = await requireStaffManager(req, res);
    if (!me) return;
    const id = Number(req.params.id);
    const body = z
      .object({
        loginId: z.string().min(3).max(64).optional(),
        name: z.string().min(2).max(120).optional(),
        status: z.enum(['active', 'blocked']).optional(),
      })
      .parse(req.body);

    const target = await getAdminRow(id);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    if (Number(target.isSuperadmin) && Number(me.id) !== id && !Number(me.isSuperadmin)) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Cannot edit Super Admin',
      });
    }

    const loginId = body.loginId
      ? body.loginId.trim().toLowerCase()
      : target.loginId;
    const name = body.name ? body.name.trim() : target.name;
    const status = body.status || target.status;
    if (body.loginId && !/^[a-z0-9._-]+$/i.test(loginId)) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_USERNAME',
        message: 'Username: letters, numbers, . _ - only',
      });
    }

    try {
      await query(
        `UPDATE users SET login_id = :loginId, name = :name, status = :status
         WHERE id = :id AND role = 'admin'`,
        { loginId, name, status, id }
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          ok: false,
          error: 'USERNAME_TAKEN',
          message: 'Username already taken',
        });
      }
      throw err;
    }

    const row = await getAdminRow(id);
    const screens = Number(row.isSuperadmin)
      ? ADMIN_SCREEN_KEYS
      : await loadScreens(id);
    res.json({ ok: true, user: mapStaff(row, screens) });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id/password',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const me = await requireStaffManager(req, res);
      if (!me) return;
      const id = Number(req.params.id);
      const body = z
        .object({ password: z.string().min(4).max(72) })
        .parse(req.body);
      const target = await getAdminRow(id);
      if (!target) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (
        Number(target.isSuperadmin) &&
        Number(me.id) !== id &&
        !Number(me.isSuperadmin)
      ) {
        return res.status(403).json({
          ok: false,
          error: 'FORBIDDEN',
          message: 'Cannot change Super Admin password',
        });
      }
      const hash = await bcrypt.hash(body.password, 10);
      await query(`UPDATE users SET password_hash = :hash WHERE id = :id`, {
        hash,
        id,
      });
      await query(`DELETE FROM refresh_tokens WHERE user_id = :id`, { id });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id/screens',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const me = await requireStaffManager(req, res);
      if (!me) return;
      const id = Number(req.params.id);
      const body = z
        .object({ screens: z.array(z.string()).default([]) })
        .parse(req.body);
      const screens = normalizeScreens(body.screens);
      const target = await getAdminRow(id);
      if (!target) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      if (Number(target.isSuperadmin)) {
        return res.status(400).json({
          ok: false,
          error: 'SUPERADMIN',
          message: 'Super Admin already has all screens',
        });
      }
      if (!screens.length) {
        return res.status(400).json({
          ok: false,
          error: 'SCREENS_REQUIRED',
          message: 'Select at least one screen',
        });
      }
      await withTransaction(async (conn) => {
        await conn.execute(`DELETE FROM admin_user_screens WHERE user_id = ?`, [
          id,
        ]);
        for (const key of screens) {
          await conn.execute(
            `INSERT INTO admin_user_screens (user_id, screen_key) VALUES (?, ?)`,
            [id, key]
          );
        }
      });
      const row = await getAdminRow(id);
      res.json({ ok: true, user: mapStaff(row, screens) });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const me = await requireStaffManager(req, res);
    if (!me) return;
    const id = Number(req.params.id);
    if (id === Number(me.id)) {
      return res.status(400).json({
        ok: false,
        error: 'SELF',
        message: 'Cannot delete your own account',
      });
    }
    const target = await getAdminRow(id);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    if (Number(target.isSuperadmin)) {
      return res.status(403).json({
        ok: false,
        error: 'FORBIDDEN',
        message: 'Cannot delete Super Admin',
      });
    }
    await query(`DELETE FROM users WHERE id = :id AND role = 'admin'`, { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.loadScreens = loadScreens;
module.exports.ADMIN_SCREEN_KEYS = ADMIN_SCREEN_KEYS;
