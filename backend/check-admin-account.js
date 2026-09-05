const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });

  const [tables] = await pool.query("SHOW TABLES");
  const names = tables.map(t => Object.values(t)[0]);
  console.log('Tables:', names.filter(n => /admin|user/i.test(n)));

  for (const tbl of names.filter(n => /admin|user/i.test(n))) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM ${tbl}`);
    console.log(`\n${tbl} columns:`, cols.map(c => c.Field).join(', '));
    const [rows] = await pool.query(`SELECT * FROM ${tbl} WHERE email = ?`, ['ashraf.milon@gmail.com']);
    for (const r of rows) {
      // don't print the password hash
      if (r.password_hash) r.password_hash = `<${r.password_hash.length} chars>`;
      if (r.password) r.password = '<set>';
      console.log(`\n${tbl} row:`, JSON.stringify(r, null, 2));
    }
    const [all] = await pool.query(`SELECT email, role FROM ${tbl}`).catch(() => [[]]);
    console.log(`${tbl} all (email, role):`, JSON.stringify(all));
  }

  await pool.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
