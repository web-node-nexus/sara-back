const { query } = require('../config/db');
const cache = require('../config/redis');

const CACHE_KEY = 'notification:settings:v1';

const KIND_COLUMN = {
  result: 'notify_result',
  call: 'notify_call',
  message: 'notify_message',
  bid: 'notify_bid',
  withdraw: 'notify_withdraw',
  deposit: 'notify_deposit',
  win: 'notify_win',
  starline: 'notify_starline',
  jackpot: 'notify_jackpot',
  admin: null,
};

const DEFAULTS = {
  result: true,
  call: true,
  message: true,
  bid: true,
  withdraw: true,
  deposit: true,
  win: true,
  starline: true,
  jackpot: true,
};

function mapSettings(row) {
  if (!row) return { ...DEFAULTS };
  return {
    result: !!row.notify_result,
    call: !!row.notify_call,
    message: !!row.notify_message,
    bid: !!row.notify_bid,
    withdraw: !!row.notify_withdraw,
    deposit: !!row.notify_deposit,
    win: !!row.notify_win,
    starline: !!row.notify_starline,
    jackpot: !!row.notify_jackpot,
  };
}

async function bustCache() {
  await cache.del(CACHE_KEY);
}

async function getNotificationSettings() {
  const cached = await cache.get(CACHE_KEY);
  if (cached) return cached;

  const rows = await query(
    `SELECT notify_result, notify_call, notify_message, notify_bid,
            notify_withdraw, notify_deposit, notify_win,
            notify_starline, notify_jackpot
     FROM notification_settings WHERE id = 1 LIMIT 1`
  );
  const settings = mapSettings(rows[0]);
  await cache.set(CACHE_KEY, settings, 120);
  return settings;
}

async function updateNotificationSettings(fields) {
  const sets = [];
  const params = {};
  for (const [key, col] of Object.entries(KIND_COLUMN)) {
    if (col && fields[key] !== undefined) {
      sets.push(`${col} = :${key}`);
      params[key] = fields[key] ? 1 : 0;
    }
  }
  if (!sets.length) return getNotificationSettings();

  await query(
    `UPDATE notification_settings SET ${sets.join(', ')} WHERE id = 1`,
    params
  );
  await bustCache();
  return getNotificationSettings();
}

async function isKindEnabled(kind) {
  const k = String(kind || 'admin').toLowerCase();
  if (k === 'admin') return true;
  const normalized = k === 'market' ? 'result' : k;
  const col = KIND_COLUMN[normalized];
  if (!col) return true;
  const settings = await getNotificationSettings();
  return settings[normalized] !== false;
}

module.exports = {
  getNotificationSettings,
  updateNotificationSettings,
  isKindEnabled,
  KIND_COLUMN,
};
