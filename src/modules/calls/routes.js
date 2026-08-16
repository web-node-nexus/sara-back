const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const {
  getFirebaseAdmin,
  sendCallPush,
} = require('../../services/pushNotifications');

const router = express.Router();

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Public TURN — required for many mobile/NAT networks (voice won't connect on STUN alone)
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/** Short-lived Firebase Auth custom token for RTDB signaling */
router.post('/firebase-token', requireAuth, async (req, res, next) => {
  try {
    const admin = getFirebaseAdmin();
    if (!admin) {
      return res.status(503).json({
        ok: false,
        error: 'FIREBASE_UNAVAILABLE',
        message: 'Firebase not configured on server',
      });
    }
    const uid = String(req.user.id);
    const token = await admin.auth().createCustomToken(uid, {
      role: req.user.role,
      loginId: req.user.loginId || '',
    });
    res.json({
      ok: true,
      token,
      uid,
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Poll pending ringing invites for the logged-in user.
 * Works even when Firebase client Auth / RTDB listen fails (Expo Go, Auth not enabled).
 * MUST be registered before /:callId routes.
 */
router.get('/pending', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT call_id AS callId, thread_id AS threadId,
              caller_id AS callerId, callee_id AS calleeId,
              caller_name AS callerName, status, created_at AS createdAt
       FROM call_invites
       WHERE callee_id = :me AND status = 'ringing'
         AND created_at > (NOW() - INTERVAL 90 SECOND)
       ORDER BY created_at DESC
       LIMIT 5`,
      { me: req.user.id }
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * Start a 1:1 call on a chat thread.
 * Player → claimed/assigned provider (or any active provider).
 * Provider → thread's player.
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        threadId: z.number().int().positive(),
      })
      .parse(req.body);

    const threads = await query(
      `SELECT id, user_id, provider_id, claimed_provider_id
       FROM chat_threads WHERE id = :id LIMIT 1`,
      { id: body.threadId }
    );
    const thread = threads[0];
    if (!thread) {
      return res.status(404).json({ ok: false, error: 'THREAD_NOT_FOUND' });
    }

    const isPlayer = req.user.role === 'player';
    const isProvider =
      req.user.role === 'provider' || req.user.role === 'admin';

    let callerId = req.user.id;
    let calleeId = null;

    if (isPlayer) {
      if (thread.user_id !== req.user.id) {
        return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      }
      calleeId =
        thread.claimed_provider_id || thread.provider_id || null;
      if (!calleeId) {
        const providers = await query(
          `SELECT id FROM users
           WHERE role = 'provider' AND status = 'active'
           ORDER BY id ASC LIMIT 1`
        );
        calleeId = providers[0]?.id || null;
      }
      if (!calleeId) {
        return res.status(400).json({
          ok: false,
          error: 'NO_PROVIDER',
          message: 'No provider is available',
        });
      }
    } else if (isProvider) {
      calleeId = thread.user_id;
    } else {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    if (calleeId === callerId) {
      return res.status(400).json({ ok: false, error: 'INVALID_CALLEE' });
    }

    const calleeRows = await query(
      `SELECT id, name, role FROM users WHERE id = :id LIMIT 1`,
      { id: calleeId }
    );
    const callee = calleeRows[0];
    if (!callee) {
      return res.status(404).json({ ok: false, error: 'CALLEE_NOT_FOUND' });
    }

    const callerRows = await query(
      `SELECT id, name, role FROM users WHERE id = :id LIMIT 1`,
      { id: callerId }
    );
    const caller = callerRows[0];

    const callId = uuidv4().replace(/-/g, '').slice(0, 20);
    const invite = {
      callId,
      threadId: thread.id,
      callerId,
      callerName: caller?.name || 'Caller',
      calleeId,
      createdAt: Date.now(),
    };

    // Durable invite for API polling (primary ring path)
    await query(
      `INSERT INTO call_invites
         (call_id, thread_id, caller_id, callee_id, caller_name, status)
       VALUES
         (:callId, :threadId, :callerId, :calleeId, :callerName, 'ringing')`,
      {
        callId,
        threadId: thread.id,
        callerId,
        calleeId,
        callerName: invite.callerName,
      }
    );

    // RTDB invite + call room (best-effort — used for WebRTC signaling)
    const admin = getFirebaseAdmin();
    if (admin) {
      try {
        await admin
          .database()
          .ref(`incoming/${calleeId}/${callId}`)
          .set(invite);
        await admin.database().ref(`calls/${callId}`).set({
          meta: {
            callId,
            threadId: thread.id,
            callerId,
            calleeId,
            status: 'ringing',
            createdAt: Date.now(),
          },
          offer: null,
          answer: null,
          candidates: {},
        });
      } catch (err) {
        console.error('[call] rtdb invite:', err.message);
      }
    }

    await sendCallPush({
      recipientUserId: calleeId,
      title: 'Incoming call',
      body: `${caller?.name || 'Someone'} calling…`,
      callId,
      threadId: thread.id,
      callerId,
      callerName: caller?.name || 'Caller',
    }).catch((err) => console.error('[call] push:', err.message));

    res.status(201).json({
      ok: true,
      callId,
      threadId: thread.id,
      callerId,
      calleeId,
      peerName: callee.name,
      peerRole: callee.role,
      iceServers: ICE_SERVERS,
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
    });
  } catch (err) {
    next(err);
  }
});

/** Clear ringing invite (accept / reject) */
router.post('/:callId/clear-invite', requireAuth, async (req, res, next) => {
  try {
    const callId = String(req.params.callId || '');
    await query(
      `UPDATE call_invites
       SET status = 'accepted'
       WHERE call_id = :callId AND callee_id = :me AND status = 'ringing'`,
      { callId, me: req.user.id }
    ).catch(() => null);

    const admin = getFirebaseAdmin();
    if (admin && callId) {
      await admin
        .database()
        .ref(`incoming/${req.user.id}/${callId}`)
        .remove()
        .catch(() => null);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Reject invite */
router.post('/:callId/reject', requireAuth, async (req, res, next) => {
  try {
    const callId = String(req.params.callId || '');
    await query(
      `UPDATE call_invites
       SET status = 'rejected'
       WHERE call_id = :callId AND callee_id = :me`,
      { callId, me: req.user.id }
    ).catch(() => null);

    const admin = getFirebaseAdmin();
    if (admin && callId) {
      await admin
        .database()
        .ref(`calls/${callId}/meta`)
        .update({ status: 'rejected', endedAt: Date.now() })
        .catch(() => null);
      await admin
        .database()
        .ref(`incoming/${req.user.id}/${callId}`)
        .remove()
        .catch(() => null);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** End call + clear callee invite */
router.post('/:callId/end', requireAuth, async (req, res, next) => {
  try {
    const callId = String(req.params.callId || '');
    await query(
      `UPDATE call_invites SET status = 'ended' WHERE call_id = :callId`,
      { callId }
    ).catch(() => null);

    const admin = getFirebaseAdmin();
    if (admin && callId) {
      const snap = await admin.database().ref(`calls/${callId}/meta`).get();
      const meta = snap.val() || {};
      await admin
        .database()
        .ref(`calls/${callId}/meta`)
        .update({ status: 'ended', endedAt: Date.now() })
        .catch(() => null);
      const calleeId = meta.calleeId;
      if (calleeId) {
        await admin
          .database()
          .ref(`incoming/${calleeId}/${callId}`)
          .remove()
          .catch(() => null);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Get call status (API poll fallback) */
router.get('/:callId/status', requireAuth, async (req, res, next) => {
  try {
    const callId = String(req.params.callId || '');
    const rows = await query(
      `SELECT call_id AS callId, status, caller_id AS callerId,
              callee_id AS calleeId, caller_name AS callerName,
              thread_id AS threadId
       FROM call_invites WHERE call_id = :callId LIMIT 1`,
      { callId }
    );
    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    const row = rows[0];
    if (
      Number(row.callerId) !== Number(req.user.id) &&
      Number(row.calleeId) !== Number(req.user.id)
    ) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }
    res.json({ ok: true, ...row });
  } catch (err) {
    next(err);
  }
});

/** Update call status (accepted / connected) without Firebase */
router.post('/:callId/status', requireAuth, async (req, res, next) => {
  try {
    const callId = String(req.params.callId || '');
    const body = z
      .object({
        status: z.enum(['accepted', 'connected', 'rejected', 'ended']),
      })
      .parse(req.body);

    const rows = await query(
      `SELECT caller_id AS callerId, callee_id AS calleeId
       FROM call_invites WHERE call_id = :callId LIMIT 1`,
      { callId }
    );
    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    const row = rows[0];
    if (
      Number(row.callerId) !== Number(req.user.id) &&
      Number(row.calleeId) !== Number(req.user.id)
    ) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    await query(
      `UPDATE call_invites SET status = :status WHERE call_id = :callId`,
      { callId, status: body.status }
    );

    const admin = getFirebaseAdmin();
    if (admin) {
      await admin
        .database()
        .ref(`calls/${callId}/meta`)
        .update({ status: body.status, updatedAt: Date.now() })
        .catch(() => null);
      if (body.status === 'accepted' || body.status === 'connected') {
        await admin
          .database()
          .ref(`incoming/${row.calleeId}/${callId}`)
          .remove()
          .catch(() => null);
      }
    }

    res.json({ ok: true, status: body.status });
  } catch (err) {
    next(err);
  }
});

router.get('/:callId/config', requireAuth, async (req, res) => {
  res.json({
    ok: true,
    iceServers: ICE_SERVERS,
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
  });
});

module.exports = router;
