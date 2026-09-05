// Usage: node run-migration.js migrations/<file>.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node run-migration.js migrations/<file>.sql');
    process.exit(1);
  }

  const sql = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    multipleStatements: false,
  });

  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      console.log('OK:', stmt.split('\n')[0].slice(0, 80));
    } catch (err) {
      // Older MariaDB/MySQL without IF NOT EXISTS support for ADD COLUMN
      if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME') {
        console.log('SKIP (already exists):', stmt.split('\n')[0].slice(0, 80));
      } else {
        console.error('FAILED:', stmt.split('\n')[0].slice(0, 120));
        throw err;
      }
    }
  }

  await conn.end();
  console.log('\nMigration complete.');
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
