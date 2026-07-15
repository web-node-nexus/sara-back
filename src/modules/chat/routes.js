const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

const router = express.Router();

router.post(
  '/threads',
  requireAuth,
  async (req, res, next) => {
    try {
      const body = z
        .object({
          userId: z.number().int().positive().optional(),
          providerId: z.number().int().positive().optional(),
        })
        .parse(req.body);

      let userId;
      let providerId;
      if (req.user.role === 'player') {
        userId = req.user.id;
        const me = await query(
          `SELECT provider_id FROM users WHERE id = :id LIMIT 1`,
          { id: req.user.id }
        );
        providerId = body.providerId || me[0]?.provider_id;
        if (!providerId) {
          return res.status(400).json({
            ok: false,
            error: 'NO_PROVIDER',
            message: 'Player has no assigned provider',
          });
        }
      } else {
        providerId = req.user.id;
        userId = body.userId;
        if (!userId) {
          return res.status(400).json({ ok: false, error: 'USER_REQUIRED' });
        }
      }

      const existing = await query(
        `SELECT id FROM chat_threads
         WHERE user_id = :userId AND provider_id = :providerId LIMIT 1`,
        { userId, providerId }
      );
      if (existing[0]) {
        return res.json({ ok: true, threadId: existing[0].id, existing: true });
      }
      const result = await query(
        `INSERT INTO chat_threads (user_id, provider_id) VALUES (:userId, :providerId)`,
        { userId, providerId }
      );
      res.status(201).json({ ok: true, threadId: result.insertId });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/threads/:threadId/read',
  requireAuth,
  requireRole('provider', 'admin'),
  async (req, res, next) => {
    try {
      const threadId = Number(req.params.threadId);
      await query(
        `UPDATE chat_threads SET unread_for_provider = 0
         WHERE id = :threadId AND provider_id = :providerId`,
        { threadId, providerId: req.user.id }
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/threads',
  requireAuth,
  requireRole('provider', 'admin', 'player'),
  async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      if (req.user.role === 'player') {
        const rows = await query(
          `SELECT t.id, t.user_id AS userId, t.provider_id AS providerId,
                  t.unread_for_provider AS unreadForProvider,
                  t.last_message_preview AS lastMessagePreview,
                  t.last_message_at AS lastMessageAt,
                  t.updated_at AS updatedAt
           FROM chat_threads t
           WHERE t.user_id = :userId
           ORDER BY t.updated_at DESC
           LIMIT ${limit}`,
          { userId: req.user.id }
        );
        return res.json({ ok: true, items: rows });
      }
      const rows = await query(
        `SELECT t.id, t.user_id AS userId, t.provider_id AS providerId,
                t.unread_for_provider AS unreadForProvider,
                t.last_message_preview AS lastMessagePreview,
                t.last_message_at AS lastMessageAt,
                t.updated_at AS updatedAt,
                u.name AS userName
         FROM chat_threads t
         JOIN users u ON u.id = t.user_id
         WHERE t.provider_id = :providerId
         ORDER BY t.updated_at DESC
         LIMIT ${limit}`,
        { providerId: req.user.id }
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/threads/:threadId/messages',
  requireAuth,
  async (req, res, next) => {
    try {
      const threadId = Number(req.params.threadId);
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const cursor = req.query.cursor ? Number(req.query.cursor) : null;

      const threads = await query(
        `SELECT id, user_id, provider_id FROM chat_threads WHERE id = :id LIMIT 1`,
        { id: threadId }
      );
      const thread = threads[0];
      if (!thread) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }
      const allowed =
        req.user.role === 'admin' ||
        thread.user_id === req.user.id ||
        thread.provider_id === req.user.id;
      if (!allowed) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      }

      const rows = await query(
        `SELECT id, sender_role AS sender, sender_id AS senderId, text,
                attachment_kind AS attachmentKind,
                attachment_name AS attachmentName,
                attachment_uri AS attachmentUri,
                attachment_duration_ms AS attachmentDurationMs,
                status, created_at AS createdAt
         FROM chat_messages
         WHERE thread_id = :threadId
           AND (:cursor IS NULL OR id < :cursor)
         ORDER BY id DESC
         LIMIT ${limit}`,
        { threadId, cursor }
      );
      res.json({
        ok: true,
        items: rows.reverse(),
        nextCursor: rows.length ? rows[0].id : null,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/threads/:threadId/messages', requireAuth, async (req, res, next) => {
  try {
    const threadId = Number(req.params.threadId);
    const body = z
      .object({
        text: z.string().max(2000).optional(),
        attachment: z
          .object({
            kind: z.enum(['image', 'file', 'audio']),
            name: z.string().max(255),
            uri: z.string().min(1),
            durationMs: z.number().int().positive().optional(),
          })
          .optional(),
      })
      .parse(req.body);

    const threads = await query(
      `SELECT id, user_id, provider_id, unread_for_provider
       FROM chat_threads WHERE id = :id LIMIT 1`,
      { id: threadId }
    );
    const thread = threads[0];
    if (!thread) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    const isProvider =
      req.user.role === 'provider' || req.user.role === 'admin';
    const allowed =
      req.user.role === 'admin' ||
      thread.user_id === req.user.id ||
      thread.provider_id === req.user.id;
    if (!allowed) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    const senderRole = isProvider && thread.provider_id === req.user.id
      ? 'provider'
      : req.user.role === 'player'
        ? 'user'
        : isProvider
          ? 'provider'
          : 'user';
    const text =
      (body.text || '').trim() ||
      (body.attachment
        ? body.attachment.kind === 'audio'
          ? 'Voice note'
          : body.attachment.name
        : '');
    if (!text && !body.attachment) {
      return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
    }

    const preview =
      body.attachment?.kind === 'audio'
        ? '🎤 Voice note'
        : body.attachment
          ? `📎 ${body.attachment.name}`
          : text;

    const msg = await withTransaction(async (conn) => {
      const [ins] = await conn.execute(
        `INSERT INTO chat_messages
          (thread_id, sender_role, sender_id, text,
           attachment_kind, attachment_name, attachment_uri, attachment_duration_ms)
         VALUES
          (:threadId, :senderRole, :senderId, :text,
           :kind, :name, :uri, :durationMs)`,
        {
          threadId,
          senderRole,
          senderId: req.user.id,
          text,
          kind: body.attachment?.kind || null,
          name: body.attachment?.name || null,
          uri: body.attachment?.uri || null,
          durationMs: body.attachment?.durationMs || null,
        }
      );
      const unread =
        senderRole === 'user' ? Number(thread.unread_for_provider) + 1 : 0;
      await conn.execute(
        `UPDATE chat_threads
         SET last_message_preview = :preview,
             last_message_at = NOW(),
             unread_for_provider = :unread,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = :threadId`,
        { preview, unread, threadId }
      );
      return { id: ins.insertId };
    });

    res.status(201).json({ ok: true, messageId: msg.id, preview });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
