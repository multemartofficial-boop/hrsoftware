// Phase F fix test: auto-detected check-in location (no manual selection)
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

  // ===== 1. GPS within Stratford's radius → auto-detected, no location sent =====
  console.log('=== 1. AUTO-DETECT WITHIN RADIUS ===');
  const c1 = await api('POST', '/api/worker/attendance/checkin', {
    latitude: 51.5421, longitude: -0.0018   // NO location field sent
  }, wToken);
  console.log(`Check-in: ${c1.status}, location="${c1.data?.location}", mismatch=${c1.data?.locationMismatch}, dist=${c1.data?.distanceMeters}m`);
  if (c1.status === 201 && c1.data?.location === 'Stratford Yard' && c1.data?.locationMismatch === false) {
    console.log('OK: auto-detected Stratford Yard, no manual selection');
  } else { ok = false; console.log('FAIL: expected Stratford Yard auto-detected'); }
  const [att1] = await pool.query('SELECT location, nearest_location, distance_meters FROM attendance WHERE id = ?', [c1.data.id]);
  console.log(`Stored: location=${att1[0]?.location}, nearest=${att1[0]?.nearest_location}, dist=${att1[0]?.distance_meters}m`);
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);

  // ===== 2. GPS outside ALL radii → Unknown/Unmatched + nearest + distance =====
  console.log('\n=== 2. GPS OUTSIDE ALL LOCATIONS ===');
  const c2 = await api('POST', '/api/worker/attendance/checkin', {
    latitude: 51.0000, longitude: -0.5000   // far from all sites
  }, wToken);
  console.log(`Check-in: ${c2.status}, location="${c2.data?.location}", mismatch=${c2.data?.locationMismatch}, nearest=${c2.data?.nearestLocation}, dist=${c2.data?.distanceMeters}m`);
  if (c2.status === 201 && c2.data?.location === 'Unknown/Unmatched' && c2.data?.locationMismatch === true && c2.data?.nearestLocation) {
    console.log('OK: allowed + flagged + nearest location reference stored');
  } else { ok = false; console.log('FAIL: expected Unknown/Unmatched + mismatch + nearest'); }
  const [att2] = await pool.query('SELECT location, location_mismatch, nearest_location, distance_meters FROM attendance WHERE id = ?', [c2.data.id]);
  console.log(`Stored: location=${att2[0]?.location}, mismatch=${att2[0]?.location_mismatch}, nearest=${att2[0]?.nearest_location}, dist=${att2[0]?.distance_meters}m`);

  // Live Map active shifts should show this worker (red pin data)
  const { data: active } = await api('GET', '/api/attendance/active/shifts');
  const s2 = active.find(s => s.worker_id === wid);
  if (s2 && s2.location_mismatch === 1 && s2.check_in_lat != null) {
    console.log('OK: Live Map still sees the worker pin (red) with GPS');
  } else { ok = false; console.log('FAIL: worker missing from active shifts'); }
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);

  // ===== 3. Assignment match via auto-detected location =====
  console.log('\n=== 3. ASSIGNMENT MATCH (auto-detected) ===');
  await api('POST', '/api/assignments', { workerId: wid, locationId: strat.id, date: todayStr });
  const c3 = await api('POST', '/api/worker/attendance/checkin', {
    latitude: 51.5421, longitude: -0.0018  // at Stratford, assigned to Stratford
  }, wToken);
  console.log(`Check-in: location="${c3.data?.location}", assignmentStatus=${c3.data?.assignmentStatus}, assigned=${c3.data?.assignedLocation}`);
  if (c3.data?.assignmentStatus === 'match') console.log('OK: assignment match via auto-detected location');
  else { ok = false; console.log('FAIL: expected assignmentStatus=match'); }
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);

  // ===== 4. Assignment mismatch: assigned Camden, GPS at Stratford =====
  console.log('\n=== 4. ASSIGNMENT MISMATCH (auto-detected) ===');
  await api('POST', '/api/assignments', { workerId: wid, locationId: camden.id, date: todayStr });
  const c4 = await api('POST', '/api/worker/attendance/checkin', {
    latitude: 51.5421, longitude: -0.0018  // GPS at Stratford, assigned Camden
  }, wToken);
  console.log(`Check-in: location="${c4.data?.location}", assignmentStatus=${c4.data?.assignmentStatus}, assigned=${c4.data?.assignedLocation}`);
  if (c4.data?.assignmentStatus === 'mismatch' && c4.data?.assignedLocation === 'Camden Site') {
    console.log('OK: assignment mismatch via auto-detected location');
  } else { ok = false; console.log('FAIL: expected mismatch vs Camden Site'); }
  const [notif] = await pool.query('SELECT message FROM notifications WHERE id = ?', [`ASGN-${c4.data.id}`]);
  console.log(`Notification: "${notif[0]?.message}"`);
  if (notif[0] && /checked in at Stratford Yard but was assigned to Camden Site/.test(notif[0].message)) {
    console.log('OK: mismatch alert correct');
  } else { ok = false; console.log('FAIL: notification missing/incorrect'); }
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);
  await pool.query('DELETE FROM worker_location_assignments WHERE worker_id = ?', [wid]);
  await pool.query('DELETE FROM notifications WHERE id LIKE "ASGN-%"');

  // ===== 5. Missing GPS still rejected =====
  console.log('\n=== 5. NO GPS → REJECTED ===');
  const c5 = await api('POST', '/api/worker/attendance/checkin', {}, wToken);
  console.log(`status=${c5.status} — "${c5.data?.error}"`);
  if (c5.status === 400) console.log('OK: GPS still required'); else { ok = false; console.log('FAIL'); }

  // ===== 6. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/workers/WKR-2026-0154/compliance','Compliance'],
    ['/api/notifications','Notifications'],['/api/settings/bank-holidays','Bank Holidays'],
    ['/api/applications','Applications'],['/api/attendance/active/shifts','Live Map data'],
    ['/api/assignments/today','Daily Assignments'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  await pool.end();
  console.log(`\n${ok ? '✅ ALL AUTO-LOCATION TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
