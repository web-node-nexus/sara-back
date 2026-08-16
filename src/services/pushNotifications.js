/**
 * Firebase Cloud Messaging — chat, calls, and admin activity alerts.
 *
 * Requires env:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (use \n for newlines in .env)
 */

const { config } = require('../config/env');
const { query } = require('../config/db');
const { isKindEnabled } = require('./notificationSettings');

let firebaseAdmin = null;
let initAttempted = false;

function getFirebaseAdmin() {
  if (initAttempted) return firebaseAdmin;
  initAttempted = true;

  const { projectId, clientEmail, privateKey } = config.firebase;
  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[fcm] Firebase credentials missing — push disabled');
    return null;
  }

  try {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
        databaseURL:
          process.env.FIREBASE_DATABASE_URL ||
          `https://${projectId}-default-rtdb.firebaseio.com`,
      });
    }
    firebaseAdmin = admin;
    console.log('[fcm] Firebase Admin initialized');
  } catch (err) {
    console.error('[fcm] Firebase init failed:', err.message);
    firebaseAdmin = null;
  }

  return firebaseAdmin;
}

async function getActiveTokensForUser(userId) {
  const rows = await query(
    `SELECT token FROM device_tokens
     WHERE user_id = :userId AND is_active = 1`,
    { userId }
  );
  return rows.map((r) => r.token).filter(Boolean);
}

async function deactivateInvalidTokens(tokens, responses) {
  const invalidTokens = [];
  responses.forEach((resp, idx) => {
    if (
      resp.error &&
      (resp.error.code === 'messaging/invalid-registration-token' ||
        resp.error.code === 'messaging/registration-token-not-registered')
    ) {
      invalidTokens.push(tokens[idx]);
    }
  });
  for (const token of invalidTokens) {
    await query(
      `UPDATE device_tokens SET is_active = 0 WHERE token = :token`,
      { token }
    );
  }
}

/**
 * Generic multicast to a user's active devices.
 */
async function sendToUser({
  recipientUserId,
  title,
  body,
  data = {},
  channelId = 'account',
  androidPriority = 'high',
  kind = 'admin',
}) {
  if (!(await isKindEnabled(kind))) {
    return { sent: 0, skipped: 'disabled' };
  }
  const admin = getFirebaseAdmin();
  if (!admin) return { sent: 0, skipped: 'no_firebase' };

  const tokens = await getActiveTokensForUser(recipientUserId);
  if (!tokens.length) return { sent: 0, skipped: 'no_tokens' };

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    stringData[k] = String(v);
  }

  const payload = {
    tokens,
    notification: {
      title: title || 'SARA 567',
      body: body || '',
    },
    data: stringData,
    android: {
      priority: androidPriority,
      notification: {
        channelId,
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
  };

  try {
    const result = await admin.messaging().sendEachForMulticast(payload);
    await deactivateInvalidTokens(tokens, result.responses);
    console.log(
      `[fcm] Sent ${result.successCount}/${tokens.length} → user ${recipientUserId} (${stringData.type || 'generic'})`
    );
    return { sent: result.successCount, failed: result.failureCount };
  } catch (err) {
    console.error('[fcm] send failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

/**
 * Send a chat push notification to all active devices of a user.
 */
async function sendChatPush({
  recipientUserId,
  title,
  body,
  threadId,
  senderRole,
}) {
  return sendToUser({
    recipientUserId,
    title: title || 'New message',
    body: body || 'You have a new message',
    channelId: 'chat',
    kind: 'message',
    data: {
      type: 'chat',
      threadId,
      senderRole: senderRole || '',
    },
  });
}

/** Incoming call push (high priority). */
async function sendCallPush({
  recipientUserId,
  title,
  body,
  callId,
  threadId,
  callerId,
  callerName,
}) {
  if (!(await isKindEnabled('call'))) {
    return { sent: 0, skipped: 'disabled' };
  }
  const admin = getFirebaseAdmin();
  if (!admin) return { sent: 0, skipped: 'no_firebase' };

  const tokens = await getActiveTokensForUser(recipientUserId);
  if (!tokens.length) return { sent: 0, skipped: 'no_tokens' };

  const payload = {
    tokens,
    notification: {
      title: title || 'Incoming call',
      body: body || 'Someone is calling…',
    },
    data: {
      type: 'incoming_call',
      callId: String(callId),
      threadId: String(threadId || ''),
      callerId: String(callerId || ''),
      callerName: String(callerName || 'Caller'),
    },
    android: {
      priority: 'high',
      ttl: 60,
      notification: {
        channelId: 'calls',
        sound: 'default',
        priority: 'max',
        visibility: 'public',
        defaultSound: true,
        defaultVibrateTimings: true,
        notificationCount: 1,
        sticky: true,
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          contentAvailable: true,
          interruptionLevel: 'time-sensitive',
        },
      },
    },
  };

  try {
    const result = await admin.messaging().sendEachForMulticast(payload);
    await deactivateInvalidTokens(tokens, result.responses);
    console.log(
      `[fcm] Call push ${result.successCount}/${tokens.length} → user ${recipientUserId}`
    );
    return { sent: result.successCount, failed: result.failureCount };
  } catch (err) {
    console.error('[fcm] call push failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

/**
 * Admin did something on a player account — always notify that user.
 */
async function sendAdminActivityPush({
  recipientUserId,
  title,
  body,
  activity,
  extra = {},
}) {
  return sendToUser({
    recipientUserId,
    title: title || 'Account update',
    body: body || 'Your account was updated by admin',
    channelId: 'account',
    kind: 'admin',
    data: {
      type: 'admin_activity',
      activity: activity || 'update',
      ...extra,
    },
  });
}

/** Non-blocking helper for routes */
function notifyAdminActivity(recipientUserId, opts) {
  if (!recipientUserId) return;
  sendAdminActivityPush({
    recipientUserId,
    ...opts,
  }).catch((err) =>
    console.error('[fcm] admin activity push:', err.message)
  );
}

/**
 * Multicast to a list of FCM tokens (chunks of 500).
 */
async function sendToTokenList({
  tokens,
  title,
  body,
  data = {},
  channelId = 'results',
}) {
  const admin = getFirebaseAdmin();
  if (!admin) return { sent: 0, skipped: 'no_firebase' };
  const list = (tokens || []).filter(Boolean);
  if (!list.length) return { sent: 0, skipped: 'no_tokens' };

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    stringData[k] = String(v);
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    try {
      const result = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: title || 'SARA 567',
          body: body || '',
        },
        data: stringData,
        android: {
          priority: 'high',
          notification: {
            channelId,
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      });
      await deactivateInvalidTokens(chunk, result.responses);
      sent += result.successCount;
      failed += result.failureCount;
    } catch (err) {
      console.error('[fcm] multicast failed:', err.message);
      failed += chunk.length;
    }
  }
  return { sent, failed };
}

/**
 * Market / Starline / Jackpot result — notify all players with active device tokens.
 */
function detectResultKind({ kind, marketId, marketName }) {
  if (kind === 'market' || kind === 'starline' || kind === 'jackpot') {
    return kind;
  }
  const hay = `${marketId || ''} ${marketName || ''}`.toLowerCase();
  if (hay.includes('starline')) return 'starline';
  if (hay.includes('jackpot')) return 'jackpot';
  return 'market';
}

async function notifyResultToAllPlayers({
  kind,
  marketId,
  marketName,
  result,
  resultDate,
}) {
  const resolvedKind = detectResultKind({ kind, marketId, marketName });
  if (!(await isKindEnabled(resolvedKind))) {
    return { sent: 0, skipped: 'disabled' };
  }
  const name = String(marketName || marketId || 'Game').trim();
  const resultText = String(result || '').trim();
  if (!resultText) return { sent: 0, skipped: 'no_result' };

  const rows = await query(
    `SELECT DISTINCT dt.token
     FROM device_tokens dt
     INNER JOIN users u ON u.id = dt.user_id
     WHERE dt.is_active = 1
       AND u.role = 'player'
       AND u.status = 'active'`
  );
  const tokens = rows.map((r) => r.token).filter(Boolean);
  if (!tokens.length) return { sent: 0, skipped: 'no_tokens' };

  const kindLabel =
    resolvedKind === 'starline'
      ? 'Starline'
      : resolvedKind === 'jackpot'
        ? 'Jackpot'
        : 'Market';

  const out = await sendToTokenList({
    tokens,
    title: `${kindLabel} Result`,
    body: `${name}: ${resultText}`,
    channelId: 'results',
    data: {
      type: `${resolvedKind}_result`,
      kind: resolvedKind,
      marketId: marketId || '',
      marketName: name,
      result: resultText,
      resultDate: resultDate || '',
    },
  });

  console.log(
    `[fcm] ${kindLabel} result ${name}=${resultText} → ${out.sent}/${tokens.length} devices`
  );

  try {
    const { fanoutResultInboxAsync } = require('./notificationService');
    fanoutResultInboxAsync({
      title: `${kindLabel} Result`,
      message: `${name}: ${resultText}`,
    });
  } catch (inboxErr) {
    console.error('[fcm] result inbox:', inboxErr.message);
  }

  return out;
}

/** @deprecated prefer notifyResultToAllPlayers — kept for scrape callers */
async function notifyMarketResult(opts) {
  return notifyResultToAllPlayers(opts);
}

/** Fire-and-forget result push (market / starline / jackpot) */
function notifyResultToAllPlayersAsync(opts) {
  notifyResultToAllPlayers(opts).catch((err) =>
    console.error('[fcm] result push:', err.message)
  );
}

/** Fire-and-forget market result push */
function notifyMarketResultAsync(opts) {
  notifyResultToAllPlayersAsync(opts);
}

module.exports = {
  sendToUser,
  sendToTokenList,
  sendChatPush,
  sendCallPush,
  sendAdminActivityPush,
  notifyAdminActivity,
  notifyMarketResult,
  notifyMarketResultAsync,
  notifyResultToAllPlayers,
  notifyResultToAllPlayersAsync,
  detectResultKind,
  getFirebaseAdmin,
};
