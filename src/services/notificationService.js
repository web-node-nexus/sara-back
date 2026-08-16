const { query } = require('../config/db');
const {
  sendToUser,
  sendToTokenList,
} = require('./pushNotifications');
const { isKindEnabled } = require('./notificationSettings');

function mapHistoryRow(r) {
  return {
    id: Number(r.id),
    title: r.title,
    message: r.message,
    targetType: r.targetType,
    targetUserId: r.targetUserId != null ? Number(r.targetUserId) : null,
    targetLabel: r.targetLabel,
    recipientCount: Number(r.recipientCount),
    sentCount: Number(r.sentCount),
    kind: r.kind,
    createdAt: r.createdAt,
  };
}

async function insertUserNotification({
  userId,
  title,
  message,
  kind,
  historyId = null,
}) {
  await query(
    `INSERT INTO user_notifications
      (user_id, history_id, title, message, kind)
     VALUES (:userId, :historyId, :title, :message, :kind)`,
    {
      userId,
      historyId,
      title: String(title || '').slice(0, 255),
      message: String(message || ''),
      kind: kind || 'admin',
    }
  );
}

async function insertHistory({
  title,
  message,
  targetType,
  targetUserId,
  targetLabel,
  recipientCount,
  sentCount,
  kind,
}) {
  const result = await query(
    `INSERT INTO notification_history
      (title, message, target_type, target_user_id, target_label,
       recipient_count, sent_count, kind)
     VALUES
      (:title, :message, :targetType, :targetUserId, :targetLabel,
       :recipientCount, :sentCount, :kind)`,
    {
      title,
      message,
      targetType,
      targetUserId: targetUserId || null,
      targetLabel,
      recipientCount,
      sentCount,
      kind: kind || 'admin',
    }
  );
  return Number(result.insertId);
}

/**
 * System / automated notification to one player (respects kind toggle).
 */
async function notifySystemEvent({
  userId,
  title,
  message,
  kind,
  data = {},
}) {
  if (!userId) return { sent: 0, skipped: 'no_user' };
  if (!(await isKindEnabled(kind))) {
    return { sent: 0, skipped: 'disabled' };
  }

  await insertUserNotification({ userId, title, message, kind });

  return sendToUser({
    recipientUserId: userId,
    title,
    body: message,
    channelId: kind === 'call' ? 'calls' : kind === 'message' ? 'chat' : 'account',
    data: { type: kind, kind, ...data },
  });
}

function notifySystemEventAsync(opts) {
  notifySystemEvent(opts).catch((err) =>
    console.error('[notify] system event failed:', err.message)
  );
}

/** Inbox copy of a declared result (FCM is sent separately). */
async function fanoutResultInbox({ title, message }) {
  if (!(await isKindEnabled('result'))) return { sent: 0, skipped: 'disabled' };
  const ids = await getActivePlayerIds();
  if (!ids.length) return { sent: 0, skipped: 'no_users' };
  const titleS = String(title || 'Market Result').slice(0, 255);
  const msgS = String(message || '');
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const values = chunk
      .map((_, idx) => `(:u${idx}, :title, :message, 'result')`)
      .join(',');
    const params = { title: titleS, message: msgS };
    chunk.forEach((id, idx) => {
      params[`u${idx}`] = id;
    });
    await query(
      `INSERT INTO user_notifications (user_id, title, message, kind)
       VALUES ${values}`,
      params
    );
  }
  return { sent: ids.length };
}

function fanoutResultInboxAsync(opts) {
  fanoutResultInbox(opts).catch((err) =>
    console.error('[notify] result inbox failed:', err.message)
  );
}

async function getActivePlayerIds(userId = null) {
  if (userId) {
    const rows = await query(
      `SELECT id FROM users
       WHERE id = :id AND role = 'player' AND status = 'active' LIMIT 1`,
      { id: userId }
    );
    return rows[0] ? [Number(rows[0].id)] : [];
  }
  const rows = await query(
    `SELECT id FROM users WHERE role = 'player' AND status = 'active'`
  );
  return rows.map((r) => Number(r.id));
}

async function getTokensForUsers(userIds) {
  if (!userIds.length) return [];
  const placeholders = userIds.map((_, i) => `:u${i}`).join(',');
  const params = Object.fromEntries(userIds.map((id, i) => [`u${i}`, id]));
  const rows = await query(
    `SELECT DISTINCT token FROM device_tokens
     WHERE is_active = 1 AND user_id IN (${placeholders})`,
    params
  );
  return rows.map((r) => r.token).filter(Boolean);
}

/** Admin manual send — always delivers (kind=admin). */
async function sendAdminBroadcast({ title, message, userId = null }) {
  const cleanTitle = String(title || '').trim().slice(0, 255);
  const cleanMessage = String(message || '').trim();
  if (!cleanTitle || !cleanMessage) {
    const err = new Error('Title and message are required');
    err.status = 400;
    err.code = 'VALIDATION';
    throw err;
  }

  let targetType = 'all';
  let targetLabel = 'All Users';
  let targetUserId = null;
  let userIds = [];

  if (userId) {
    const users = await query(
      `SELECT id, name, phone, login_id AS loginId FROM users
       WHERE id = :id AND role = 'player' LIMIT 1`,
      { id: userId }
    );
    if (!users[0]) {
      const err = new Error('User not found');
      err.status = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }
    targetType = 'user';
    targetUserId = Number(users[0].id);
    targetLabel =
      users[0].name ||
      users[0].phone ||
      users[0].loginId ||
      `User #${users[0].id}`;
    userIds = [targetUserId];
  } else {
    userIds = await getActivePlayerIds();
  }

  const recipientCount = userIds.length;
  const historyId = await insertHistory({
    title: cleanTitle,
    message: cleanMessage,
    targetType,
    targetUserId,
    targetLabel,
    recipientCount,
    sentCount: 0,
    kind: 'admin',
  });

  for (const uid of userIds) {
    await insertUserNotification({
      userId: uid,
      title: cleanTitle,
      message: cleanMessage,
      kind: 'admin',
      historyId,
    });
  }

  const tokens = await getTokensForUsers(userIds);
  let sent = 0;
  if (tokens.length) {
    const out = await sendToTokenList({
      tokens,
      title: cleanTitle,
      body: cleanMessage,
      channelId: 'account',
      data: { type: 'admin_broadcast', kind: 'admin' },
    });
    sent = out.sent || 0;
  }

  await query(
    `UPDATE notification_history SET sent_count = :sent WHERE id = :id`,
    { sent, id: historyId }
  );

  return {
    historyId,
    recipientCount,
    sent,
    targetType,
    targetLabel,
  };
}

async function listHistory(limit = 100) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const rows = await query(
    `SELECT id, title, message,
            target_type AS targetType,
            target_user_id AS targetUserId,
            target_label AS targetLabel,
            recipient_count AS recipientCount,
            sent_count AS sentCount,
            kind,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM notification_history
     ORDER BY id DESC
     LIMIT ${lim}`
  );
  return rows.map(mapHistoryRow);
}

async function deleteHistoryIds(ids) {
  const list = (ids || []).map(Number).filter((n) => n > 0);
  if (!list.length) return { deleted: 0 };
  const placeholders = list.map((_, i) => `:id${i}`).join(',');
  const params = Object.fromEntries(list.map((id, i) => [`id${i}`, id]));
  await query(
    `DELETE FROM notification_history WHERE id IN (${placeholders})`,
    params
  );
  return { deleted: list.length };
}

async function listUserNotifications(userId, limit = 50) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await query(
    `SELECT id, title, message, kind, is_read AS isRead,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
     FROM user_notifications
     WHERE user_id = :userId
     ORDER BY id DESC
     LIMIT ${lim}`,
    { userId }
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    message: r.message,
    kind: r.kind,
    isRead: !!r.isRead,
    createdAt: r.createdAt,
  }));
}

async function markNotificationRead(userId, notificationId) {
  await query(
    `UPDATE user_notifications SET is_read = 1
     WHERE id = :id AND user_id = :userId`,
    { id: notificationId, userId }
  );
  return { ok: true };
}

async function markAllNotificationsRead(userId) {
  await query(
    `UPDATE user_notifications SET is_read = 1 WHERE user_id = :userId`,
    { userId }
  );
  return { ok: true };
}

async function countUnread(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM user_notifications
     WHERE user_id = :userId AND is_read = 0`,
    { userId }
  );
  return Number(rows[0]?.c || 0);
}

module.exports = {
  notifySystemEvent,
  notifySystemEventAsync,
  fanoutResultInbox,
  fanoutResultInboxAsync,
  sendAdminBroadcast,
  listHistory,
  deleteHistoryIds,
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnread,
  insertUserNotification,
};
