const express = require('express');
const { z } = require('zod');
const { query, withTransaction } = require('../../config/db');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { sendChatPush } = require('../../services/pushNotifications');

const router = express.Router();

async function getAllProviderIds() {
  const rows = await query(
    `SELECT id FROM users
     WHERE role = 'provider' AND status = 'active'`
  );
  return rows.map((r) => r.id);
}

async function notifyProviders(providerIds, payload) {
  await Promise.all(
    providerIds.map((id) =>
      sendChatPush({
        recipientUserId: id,
        ...payload,
      }).catch((err) => console.error('[chat] push error:', err.message))
    )
  );
}

/**
 * Player: open / resume their single support thread (no assigned provider needed).
 * Provider: open thread with a specific user.
 */
router.post('/threads', requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        userId: z.number().int().positive().optional(),
      })
      .parse(req.body || {});

    if (req.user.role === 'player') {
      const userId = req.user.id;
      const existing = await query(
        `SELECT id, provider_id AS providerId, claimed_provider_id AS claimedProviderId
         FROM chat_threads
         WHERE user_id = :userId
         ORDER BY updated_at DESC
         LIMIT 1`,
        { userId }
      );
      if (existing[0]) {
        return res.json({
          ok: true,
          threadId: existing[0].id,
          existing: true,
          providerId: existing[0].providerId,
          claimedProviderId: existing[0].claimedProviderId,
        });
      }
      const result = await query(
        `INSERT INTO chat_threads (user_id, provider_id, claimed_provider_id)
         VALUES (:userId, NULL, NULL)`,
        { userId }
      );
      return res.status(201).json({
        ok: true,
        threadId: result.insertId,
        existing: false,
        providerId: null,
        claimedProviderId: null,
      });
    }

    // Provider / admin creating thread with a user
    const providerId = req.user.id;
    const userId = body.userId;
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'USER_REQUIRED' });
    }

    const existing = await query(
      `SELECT id FROM chat_threads WHERE user_id = :userId LIMIT 1`,
      { userId }
    );
    if (existing[0]) {
      return res.json({ ok: true, threadId: existing[0].id, existing: true });
    }
    const result = await query(
      `INSERT INTO chat_threads (user_id, provider_id, claimed_provider_id)
       VALUES (:userId, :providerId, :providerId)`,
      { userId, providerId }
    );
    res.status(201).json({ ok: true, threadId: result.insertId });
  } catch (err) {
    next(err);
  }
});

router.post('/threads/:threadId/read', requireAuth, async (req, res, next) => {
  try {
    const threadId = Number(req.params.threadId);

    if (req.user.role === 'player') {
      await query(
        `UPDATE chat_threads SET unread_for_user = 0
         WHERE id = :threadId AND user_id = :userId`,
        { threadId, userId: req.user.id }
      );
      // Blue ticks: provider messages become read
      await query(
        `UPDATE chat_messages SET status = 'read'
         WHERE thread_id = :threadId
           AND sender_role = 'provider'
           AND status <> 'read'`,
        { threadId }
      );
    } else {
      await query(
        `UPDATE chat_threads SET unread_for_provider = 0
         WHERE id = :threadId`,
        { threadId }
      );
      // Blue ticks: player messages become read
      await query(
        `UPDATE chat_messages SET status = 'read'
         WHERE thread_id = :threadId
           AND sender_role = 'user'
           AND status <> 'read'`,
        { threadId }
      );
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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
                  t.claimed_provider_id AS claimedProviderId,
                  t.unread_for_provider AS unreadForProvider,
                  t.unread_for_user AS unreadForUser,
                  t.last_message_preview AS lastMessagePreview,
                  t.last_message_at AS lastMessageAt,
                  t.updated_at AS updatedAt,
                  COALESCE(cp.name, p.name, 'Support') AS providerName,
                  (
                    SELECT m.sender_role FROM chat_messages m
                    WHERE m.thread_id = t.id
                    ORDER BY m.id DESC LIMIT 1
                  ) AS lastSenderRole,
                  (
                    SELECT m.id FROM chat_messages m
                    WHERE m.thread_id = t.id
                    ORDER BY m.id DESC LIMIT 1
                  ) AS lastMessageId
           FROM chat_threads t
           LEFT JOIN users p ON p.id = t.provider_id
           LEFT JOIN users cp ON cp.id = t.claimed_provider_id
           WHERE t.user_id = :userId
           ORDER BY t.updated_at DESC
           LIMIT ${limit}`,
          { userId: req.user.id }
        );
        return res.json({ ok: true, items: rows });
      }

      // Shared inbox — all providers see every player support thread
      const rows = await query(
        `SELECT t.id, t.user_id AS userId, t.provider_id AS providerId,
                t.claimed_provider_id AS claimedProviderId,
                t.unread_for_provider AS unreadForProvider,
                t.unread_for_user AS unreadForUser,
                t.last_message_preview AS lastMessagePreview,
                t.last_message_at AS lastMessageAt,
                t.updated_at AS updatedAt,
                u.name AS userName,
                u.phone AS userPhone,
                cp.name AS claimedProviderName,
                CASE
                  WHEN t.claimed_provider_id IS NULL THEN 'open'
                  WHEN t.claimed_provider_id = :me THEN 'mine'
                  ELSE 'claimed'
                END AS claimStatus,
                (
                  SELECT m.sender_role FROM chat_messages m
                  WHERE m.thread_id = t.id
                  ORDER BY m.id DESC LIMIT 1
                ) AS lastSenderRole,
                (
                  SELECT m.id FROM chat_messages m
                  WHERE m.thread_id = t.id
                  ORDER BY m.id DESC LIMIT 1
                ) AS lastMessageId
         FROM chat_threads t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN users cp ON cp.id = t.claimed_provider_id
         ORDER BY
           CASE WHEN t.claimed_provider_id IS NULL THEN 0 ELSE 1 END,
           t.updated_at DESC
         LIMIT ${limit}`,
        { me: req.user.id }
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/threads/:threadId/messages', requireAuth, async (req, res, next) => {
  try {
    const threadId = Number(req.params.threadId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;

    const threads = await query(
      `SELECT t.id, t.user_id, t.provider_id, t.claimed_provider_id,
              cp.name AS claimedProviderName
       FROM chat_threads t
       LEFT JOIN users cp ON cp.id = t.claimed_provider_id
       WHERE t.id = :id LIMIT 1`,
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
      isProvider;
    if (!allowed) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    // Double tick: mark other party's "sent" messages as delivered
    const otherRole =
      req.user.role === 'player' ? 'provider' : 'user';
    await query(
      `UPDATE chat_messages SET status = 'delivered'
       WHERE thread_id = :threadId
         AND sender_role = :otherRole
         AND status = 'sent'`,
      { threadId, otherRole }
    );

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
      thread: {
        id: thread.id,
        userId: thread.user_id,
        providerId: thread.provider_id,
        claimedProviderId: thread.claimed_provider_id,
        claimedProviderName: thread.claimedProviderName || null,
        claimStatus:
          !thread.claimed_provider_id
            ? 'open'
            : thread.claimed_provider_id === req.user.id
              ? 'mine'
              : 'claimed',
      },
    });
  } catch (err) {
    next(err);
  }
});

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
      `SELECT id, user_id, provider_id, claimed_provider_id,
              unread_for_provider, unread_for_user
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
      isProvider;
    if (!allowed) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    const senderRole = req.user.role === 'player' ? 'user' : 'provider';

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

    // First provider reply claims the thread
    const shouldClaim =
      senderRole === 'provider' && !thread.claimed_provider_id;

    const msg = await withTransaction(async (conn) => {
      const [ins] = await conn.execute(
        `INSERT INTO chat_messages
          (thread_id, sender_role, sender_id, text,
           attachment_kind, attachment_name, attachment_uri, attachment_duration_ms, status)
         VALUES
          (:threadId, :senderRole, :senderId, :text,
           :kind, :name, :uri, :durationMs, 'sent')`,
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

      const unreadProvider =
        senderRole === 'user' ? Number(thread.unread_for_provider) + 1 : 0;
      const unreadUser =
        senderRole === 'provider'
          ? Number(thread.unread_for_user || 0) + 1
          : Number(thread.unread_for_user || 0);

      if (shouldClaim) {
        await conn.execute(
          `UPDATE chat_threads
           SET last_message_preview = :preview,
               last_message_at = NOW(),
               unread_for_provider = :unreadProvider,
               unread_for_user = :unreadUser,
               provider_id = :claimId,
               claimed_provider_id = :claimId,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = :threadId`,
          {
            preview,
            unreadProvider,
            unreadUser,
            claimId: req.user.id,
            threadId,
          }
        );
      } else {
        await conn.execute(
          `UPDATE chat_threads
           SET last_message_preview = :preview,
               last_message_at = NOW(),
               unread_for_provider = :unreadProvider,
               unread_for_user = :unreadUser,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = :threadId`,
          { preview, unreadProvider, unreadUser, threadId }
        );
      }

      return { id: ins.insertId };
    });

    // Push notifications
    (async () => {
      try {
        const names = await query(
          `SELECT name FROM users WHERE id = :id LIMIT 1`,
          { id: req.user.id }
        );
        const pushTitle =
          names[0]?.name || (senderRole === 'user' ? 'Player' : 'Provider');

        if (senderRole === 'user') {
          // Broadcast to ALL active providers
          const providerIds = await getAllProviderIds();
          await notifyProviders(providerIds, {
            title: pushTitle,
            body: preview,
            threadId,
            senderRole,
          });
        } else {
          await sendChatPush({
            recipientUserId: thread.user_id,
            title: pushTitle,
            body: preview,
            threadId,
            senderRole,
          });
        }
      } catch (err) {
        console.error('[chat] push error:', err.message);
      }
    })();

    res.status(201).json({
      ok: true,
      messageId: msg.id,
      preview,
      claimed: shouldClaim,
      claimedProviderId: shouldClaim ? req.user.id : thread.claimed_provider_id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
