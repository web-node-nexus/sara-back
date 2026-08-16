const express = require('express');
const { z } = require('zod');
const { query } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

/** Register or refresh FCM device token for the logged-in user */
router.post('/register', requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        token: z.string().min(10).max(512),
        platform: z.enum(['ios', 'android', 'web']).default('android'),
      })
      .parse(req.body);

    // Upsert: reassign token to current user if it already exists
    await query(
      `INSERT INTO device_tokens (user_id, token, platform, is_active)
       VALUES (:userId, :token, :platform, 1)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         platform = VALUES(platform),
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP`,
      {
        userId: req.user.id,
        token: body.token,
        platform: body.platform,
      }
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Unregister device token (on logout) */
router.post('/unregister', requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({ token: z.string().min(10).max(512) })
      .parse(req.body);

    await query(
      `UPDATE device_tokens SET is_active = 0
       WHERE user_id = :userId AND token = :token`,
      { userId: req.user.id, token: body.token }
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
