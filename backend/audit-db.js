// Read-only DB audit: find leftover test data and count everything.
require('dotenv').config();
const pool = require('./config/database');

async function main() {
  const q = async (sql, params) => (await pool.query(sql, params))[0];

  console.log('=== COUNTS ===');
  for (const t of ['workers', 'users', 'registration_applications', 'attendance', 'payroll',
    'locations', 'notifications', 'incidents', 'clients', 'worker_location_assignments', 'action_logs']) {
    const r = await q(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`  ${t}: ${r[0].c}`);
  }

  console.log('\n=== ALL WORKERS ===');
  const workers = await q('SELECT id, name, email, nid, status, joined, expiry FROM workers ORDER BY joined DESC');
  for (const w of workers) {
    console.log(`  ${w.id} | ${w.name} | ${w.email} | nid=${w.nid} | ${w.status}`);
  }

  console.log('\n=== SUSPECT TEST WORKERS (test emails / test names / nid=x) ===');
  const suspects = await q(
    `SELECT id, name, email, nid FROM workers
     WHERE email LIKE '%@test.com' OR email LIKE '%test%' OR nid = 'x'
        OR name LIKE '%Test%' OR name LIKE '%Tester%' OR name LIKE 'Bulk %' OR name LIKE 'Portal %'`
  );
  for (const w of suspects) console.log(`  ${w.id} | ${w.name} | ${w.email} | nid=${w.nid}`);
  if (!suspects.length) console.log('  none');

  console.log('\n=== ALL USERS ===');
  const users = await q('SELECT id, name, email, role, worker_id, created_at FROM users ORDER BY created_at DESC');
  for (const u of users) console.log(`  #${u.id} | ${u.role} | ${u.name} | ${u.email} | worker=${u.worker_id || '-'}`);

  console.log('\n=== ORPHAN USERS (worker role but worker row missing) ===');
  const orphans = await q(
    `SELECT u.id, u.name, u.email, u.worker_id FROM users u
     WHERE u.role = 'worker' AND u.worker_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM workers w WHERE w.id = u.worker_id)`
  );
  for (const u of orphans) console.log(`  #${u.id} | ${u.name} | ${u.email} | worker=${u.worker_id}`);
  if (!orphans.length) console.log('  none');

  console.log('\n=== SUSPECT TEST LOCATIONS ===');
  const locs = await q(
    `SELECT id, name FROM locations
     WHERE name LIKE '%Test%' OR name LIKE 'Bulk Site%' OR name LIKE 'Client Site%'
        OR name LIKE 'Other Site%' OR name LIKE 'Incident Test%'`
  );
  for (const l of locs) console.log(`  ${l.id} | ${l.name}`);
  if (!locs.length) console.log('  none');

  console.log('\n=== ALL LOCATIONS ===');
  const allLocs = await q('SELECT id, name, address FROM locations');
  for (const l of allLocs) console.log(`  ${l.id} | ${l.name} | ${l.address}`);

  console.log('\n=== SUSPECT TEST NOTIFICATIONS / INCIDENTS / CLIENTS ===');
  const n = await q(`SELECT id, worker, message FROM notifications WHERE worker LIKE '%Test%' OR message LIKE '%test%' LIMIT 20`);
  for (const x of n) console.log(`  N: ${x.id} | ${x.worker} | ${String(x.message).slice(0, 60)}`);
  const inc = await q(`SELECT id, reporter_name, category FROM incidents`);
  for (const x of inc) console.log(`  INC: ${x.id} | ${x.reporter_name} | ${x.category}`);
  const cl = await q(`SELECT id, name, company, email FROM clients`);
  for (const x of cl) console.log(`  CLT: ${x.id} | ${x.name} | ${x.company} | ${x.email}`);

  console.log('\n=== ORPHAN ATTENDANCE / ASSIGNMENTS (worker gone) ===');
  const oa = await q(
    `SELECT COUNT(*) AS c FROM attendance a WHERE NOT EXISTS (SELECT 1 FROM workers w WHERE w.id = a.worker_id)`);
  const oas = await q(
    `SELECT COUNT(*) AS c FROM worker_location_assignments a WHERE NOT EXISTS (SELECT 1 FROM workers w WHERE w.id = a.worker_id)`);
  console.log(`  orphan attendance rows: ${oa[0].c}`);
  console.log(`  orphan assignment rows: ${oas[0].c}`);

  console.log('\n=== RECENT ACTION LOGS (last 15) ===');
  const logs = await q('SELECT actor_name, action, target_id, created_at FROM action_logs ORDER BY created_at DESC LIMIT 15');
  for (const l of logs) console.log(`  ${l.created_at.toISOString?.() || l.created_at} | ${l.actor_name} | ${l.action} | ${l.target_id}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
