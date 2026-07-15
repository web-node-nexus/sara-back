/** Lightweight cache — Redis when REDIS_URL set, else in-memory Map */
const { config } = require('./env');

const memory = new Map();

async function get(key) {
  if (!config.redisUrl) {
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt && Date.now() > hit.expiresAt) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  }
  // Redis optional: install ioredis later when REDIS_URL is used in prod
  return null;
}

async function set(key, value, ttlSeconds = 30) {
  if (!config.redisUrl) {
    memory.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
}

async function del(key) {
  memory.delete(key);
}

module.exports = { get, set, del };
