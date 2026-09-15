// One-off cleanup of leftover TEST data found by audit-db.js (2026-09-15).
// Review the list below before running:  node cleanup-test-data.js
require('dotenv').config();
const pool = require('./config/database');

async function main() {
  // 1. Leftover test worker from a crashed test run (nid='x', @test.com email)
  const testWorkerIds = ['WKR-2026-0148'];

  // 2. Orphan users rows — their worker was deleted but the login row remained,
  //    which permanently blocks those emails from re-registering.
  //    #6  sad asd            asd@gmail.com              (worker WKR-2026-0147 deleted)
  //    #29 sda sda            ashrafadrito@gmail.com     (worker WKR-2026-0152 deleted)
  //    #32 Phase TestUser     phasea-...@test.com        (test)
  //    #33 Test Subbie        phased-...@test.com        (test)
  const orphanUserIds = [6, 29, 32, 33];

  for (const wid of testWorkerIds) {
    await pool.query('DELETE FROM attendance WHERE worker_id = ?', [wid]);
    await pool.query('DELETE FROM worker_location_assignments WHERE worker_id = ?', [wid]);
    await pool.query('DELETE FROM users WHERE worker_id = ?', [wid]);
    const [r] = await pool.query('DELETE FROM workers WHERE id = ?', [wid]);
    console.log(`worker ${wid}: removed (${r.affectedRows} row)`);
  }

  const [u] = await pool.query(
    `DELETE FROM users WHERE id IN (${orphanUserIds.map(() => '?').join(',')})`, orphanUserIds);
  console.log(`orphan users: removed ${u.affectedRows} rows`);

  // 3. Old test notifications (Notification Fix Test / Expired Test / One Month Test / Seven Days Test)
  const [n] = await pool.query(
    `DELETE FROM notifications WHERE worker IN ('Notification Fix Test', 'Expired Test', 'One Month Test', 'Seven Days Test')`);
  console.log(`test notifications: removed ${n.affectedRows} rows`);

  // 4. Orphan assignment rows (worker no longer exists)
  const [a] = await pool.query(
    `DELETE a FROM worker_location_assignments a
     WHERE NOT EXISTS (SELECT 1 FROM workers w WHERE w.id = a.worker_id)`);
  console.log(`orphan assignments: removed ${a.affectedRows} rows`);

  // 5. Test registration applications (draft/test emails) — LIST ONLY, not deleted;
  //    29 applications exist and some may be real. Review manually in Approvals.
  const [apps] = await pool.query(
    `SELECT id, name, email, status FROM registration_applications
     WHERE email LIKE '%@test.com' OR name LIKE '%Test%'`);
  console.log(`\ntest-looking applications (NOT deleted — review in Approvals):`);
  for (const x of apps) console.log(`  ${x.id} | ${x.name} | ${x.email} | ${x.status}`);

  console.log('\nCleanup complete.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
