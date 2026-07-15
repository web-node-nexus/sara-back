const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { config } = require('../config/env');

async function main() {
  const conf = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true,
  };

  const conn = await mysql.createConnection(conf);
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${config.mysql.database}\``);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log('Applying', file);
    await conn.query(sql);
  }

  const bcrypt = require('bcryptjs');
  const adminHash = await bcrypt.hash('admin123', 10);
  const spHash = await bcrypt.hash('1234', 10);
  await conn.query(
    `INSERT IGNORE INTO users (id, login_id, phone, password_hash, name, role)
     VALUES
      (1, 'admin', NULL, ?, 'Super Admin', 'admin'),
      (2, 'rahul', '9876500001', ?, 'Rahul Support', 'provider')`,
    [adminHash, spHash]
  );
  await conn.query(
    `INSERT IGNORE INTO wallets (user_id, balance) VALUES (1, 0), (2, 0)`
  );

  await conn.end();
  console.log('All migrations applied to', config.mysql.database);
  console.log('Seed users: admin/admin123 · rahul/1234');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
