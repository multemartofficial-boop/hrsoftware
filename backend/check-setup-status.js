const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });
(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const [apps] = await pool.query("SELECT id, name, email, status, worker_id FROM registration_applications WHERE status='approved' ORDER BY submitted DESC LIMIT 15");
  console.log('Approved applications:');
  for (const a of apps) console.log(' ', a.id, '|', a.name, '| worker_id:', a.worker_id);
  const [workers] = await pool.query('SELECT id, name, password_hash IS NOT NULL AS has_pw FROM workers ORDER BY id DESC LIMIT 15');
  console.log('\nWorkers (recent):');
  for (const w of workers) console.log(' ', w.id, '|', w.name, '| has_pw:', w.has_pw);
  const [orphans] = await pool.query(`SELECT a.id, a.name, a.worker_id FROM registration_applications a LEFT JOIN workers w ON w.id = a.worker_id WHERE a.status='approved' AND (a.worker_id IS NULL OR w.id IS NULL)`);
  console.log('\nApproved apps with NO matching worker row:', JSON.stringify(orphans, null, 1));
  const [linked] = await pool.query(`SELECT a.id AS app, a.worker_id, w.id AS worker, w.password_hash IS NOT NULL AS has_pw FROM registration_applications a JOIN workers w ON w.id = a.worker_id WHERE a.status='approved'`);
  console.log('\nApproved apps WITH worker row:', JSON.stringify(linked, null, 1));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
