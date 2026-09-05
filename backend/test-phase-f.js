// Phase F test: daily assignments + match/mismatch + email + notifications
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

const BASE = 'http://localhost:3001';
let TOKEN = '';
let ok = true;

async function api(method, url, body, token = TOKEN) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function main() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Admin login failed');
  TOKEN = d.token;
  console.log('Admin login OK\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });

  const wToken = (await (await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode: 'WKR-2026-0154', password: 'SubTest@123' })
  })).json()).token;
  if (!wToken) { console.log('FAIL: worker login'); process.exit(1); }

  const todayStr = new Date().toISOString().slice(0, 10);
  const wid = 'WKR-2026-0154';
  const { data: locs } = await api('GET', '/api/locations');
  const strat = locs.find(l => l.name === 'Stratford Yard');
  const camden = locs.find(l => l.name === 'Camden Site');

  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);
  await pool.query('DELETE FROM worker_location_assignments WHERE worker_id = ?', [wid]);
  await pool.query('DELETE FROM notifications WHERE id LIKE "ASGN-%"');

  // ===== 1. Create assignment for today → Stratford Yard =====
  console.log('=== 1. CREATE ASSIGNMENT ===');
  const a1 = await api('POST', '/api/assignments', { workerId: wid, locationId: strat.id, date: todayStr });
  console.log(`Assign: ${a1.status} id=${a1.data?.id} updated=${a1.data?.updated} email=${a1.data?.email}`);
  if (a1.status === 201 && a1.data?.updated === false) console.log('OK: assignment created');
  else { ok = false; console.log('FAIL: expected 201 updated=false'); }
  console.log(`Email method: ${a1.data?.email} (${a1.data?.email === 'smtp' ? 'real email sent via Gmail' : 'console-logged — SMTP not configured'})`);

  // Today's view: not checked in yet
  const { data: t1 } = await api('GET', '/api/assignments/today');
  const tr1 = t1.find(r => r.workerId === wid);
  console.log(`Today view before check-in: status=${tr1?.status}, location=${tr1?.location}`);
  if (tr1?.status === 'not_checked_in') console.log('OK: "Not checked in yet"');
  else { ok = false; console.log('FAIL: expected not_checked_in'); }

  // ===== 2. Check in at CORRECT location → match =====
  console.log('\n=== 2. CHECK-IN AT ASSIGNED LOCATION → MATCH ===');
  const c1 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5421, longitude: -0.0018
  }, wToken);
  console.log(`Check-in: ${c1.status}, assignmentStatus=${c1.data?.assignmentStatus}, assigned=${c1.data?.assignedLocation}`);
  if (c1.data?.assignmentStatus === 'match') console.log('OK: assignment match');
  else { ok = false; console.log('FAIL: expected assignmentStatus=match'); }

  const { data: t2 } = await api('GET', '/api/assignments/today');
  const tr2 = t2.find(r => r.workerId === wid);
  if (tr2?.status === 'match') console.log(`OK: Today view shows "Checked in — Matches assignment"`);
  else { ok = false; console.log(`FAIL: today view status=${tr2?.status}`); }

  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);

  // ===== 3. Reassign to different location → update-in-place =====
  console.log('\n=== 3. DUPLICATE ASSIGNMENT → UPDATE IN PLACE ===');
  const a2 = await api('POST', '/api/assignments', { workerId: wid, locationId: camden.id, date: todayStr });
  console.log(`Reassign: ${a2.status} id=${a2.data?.id} updated=${a2.data?.updated} (same id as before: ${a2.data?.id === a1.data?.id})`);
  const [dupCheck] = await pool.query('SELECT COUNT(*) AS n FROM worker_location_assignments WHERE worker_id = ? AND assigned_date = ?', [wid, todayStr]);
  if (a2.data?.updated === true && a2.data?.id === a1.data?.id && dupCheck[0].n === 1) {
    console.log('OK: reassign updated existing row (no duplicate)');
  } else { ok = false; console.log(`FAIL: updated=${a2.data?.updated}, rows=${dupCheck[0].n}`); }

  // ===== 4. Check in at DIFFERENT location → mismatch + notification =====
  console.log('\n=== 4. CHECK-IN AT WRONG LOCATION → MISMATCH + ALERT ===');
  const c2 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5421, longitude: -0.0018
  }, wToken);
  console.log(`Check-in: ${c2.status}, assignmentStatus=${c2.data?.assignmentStatus}, assigned=${c2.data?.assignedLocation}`);
  if (c2.data?.assignmentStatus === 'mismatch' && c2.data?.assignedLocation === 'Camden Site') {
    console.log('OK: assignment mismatch flagged');
  } else { ok = false; console.log('FAIL: expected mismatch vs Camden Site'); }

  const [notif] = await pool.query('SELECT id, message, urgency FROM notifications WHERE id = ?', [`ASGN-${c2.data.id}`]);
  console.log(`Notification: ${notif[0]?.id} — "${notif[0]?.message}" (urgency=${notif[0]?.urgency})`);
  if (notif[0] && /checked in at Stratford Yard but was assigned to Camden Site/.test(notif[0].message)) {
    console.log('OK: mismatch notification created with correct details');
  } else { ok = false; console.log('FAIL: notification missing/incorrect'); }

  const { data: t3 } = await api('GET', '/api/assignments/today');
  const tr3 = t3.find(r => r.workerId === wid);
  if (tr3?.status === 'mismatch') console.log(`OK: Today view shows "Checked in — MISMATCH" (actual: ${tr3.actualLocation})`);
  else { ok = false; console.log(`FAIL: today view status=${tr3?.status}`); }

  // Attendance record flag persisted
  const [attRow] = await pool.query('SELECT assignment_status FROM attendance WHERE id = ?', [c2.data.id]);
  if (attRow[0]?.assignment_status === 'mismatch') console.log('OK: assignment_status persisted on record');
  else { ok = false; console.log('FAIL: assignment_status not stored'); }

  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);
  await pool.query('DELETE FROM worker_location_assignments WHERE worker_id = ?', [wid]);

  // ===== 5. No assignment → normal check-in, no flag =====
  console.log('\n=== 5. NO ASSIGNMENT → NORMAL ===');
  const c3 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5421, longitude: -0.0018
  }, wToken);
  console.log(`Check-in: ${c3.status}, assignmentStatus=${c3.data?.assignmentStatus}`);
  if (c3.status === 201 && c3.data?.assignmentStatus === 'none') console.log('OK: no flag when no assignment');
  else { ok = false; console.log('FAIL: expected assignmentStatus=none'); }
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);
  await pool.query('DELETE FROM notifications WHERE id LIKE "ASGN-%"');

  // ===== 6. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/workers/WKR-2026-0154/compliance','Compliance'],
    ['/api/notifications','Notifications'],['/api/settings/bank-holidays','Bank Holidays'],
    ['/api/applications','Applications'],['/api/attendance/active/shifts','Live Map data'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }
  const page = await fetch('http://localhost:8080/admin/assignments');
  console.log(`${page.status === 200 ? 'OK' : 'FAIL'} ${page.status} Daily Assignments page`);

  await pool.end();
  console.log(`\n${ok ? '✅ ALL PHASE F TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
