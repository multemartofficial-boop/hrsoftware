require('dotenv').config();
const pool = require('./config/database');
(async () => {
  const [apps] = await pool.query(
    "SELECT id, email, status, worker_id FROM registration_applications WHERE email LIKE 'actionlog-%@test.com'"
  );
  console.log('leftover apps:', JSON.stringify(apps));
  for (const a of apps) {
    await pool.query('DELETE FROM password_reset_tokens WHERE email = ?', [a.email]);
    await pool.query('DELETE FROM registration_applications WHERE id = ?', [a.id]);
  }
  const [w] = await pool.query("SELECT id FROM workers WHERE name = 'Log Test Worker'");
  console.log('leftover workers:', JSON.stringify(w));
  for (const x of w) {
    await pool.query('DELETE FROM users WHERE worker_id = ?', [x.id]);
    await pool.query('DELETE FROM workers WHERE id = ?', [x.id]);
  }
  const [l] = await pool.query("SELECT id, name FROM locations WHERE name LIKE 'Log Test Site%'");
  console.log('leftover locations:', JSON.stringify(l));
  for (const x of l) await pool.query('DELETE FROM locations WHERE id = ?', [x.id]);
  const [a] = await pool.query("SELECT id, worker FROM attendance WHERE worker = 'Log Test Worker'");
  console.log('leftover attendance:', JSON.stringify(a));
  for (const x of a) await pool.query('DELETE FROM attendance WHERE id = ?', [x.id]);
  console.log('cleanup done');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
