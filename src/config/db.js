const mysql = require('mysql2/promise');
const { config } = require('./env');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: config.mysql.connectionLimit,
      namedPlaceholders: true,
      timezone: 'Z',
      enableKeepAlive: true,
      // Keep queries fast — fail early rather than hang past SLA
      connectTimeout: 1500,
    });
  }
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getPool, query, withTransaction };
