// Phase 3 test: Bulk + recurring location assignment
require('dotenv').config();
const BASE = 'http://localhost:3001';
let ADMIN = '';

async function api(method, url, body, token = ADMIN) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const res = await fetch(`${BASE}${url}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Admin login failed: ' + JSON.stringify(d));
  return d.token;
}

async function workerLogin(workerCode, password) {
  const res = await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode, password })
  });
  const d = await res.json();
  if (!d.token) throw new Error(`Worker login failed (${workerCode}): ` + JSON.stringify(d));
  return d.token;
}

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

const stamp = Date.now();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

let locId, attId;
const workerIds = [];

async function makeWorker(name, email) {
  const { status, data } = await api('POST', '/api/workers', {
    name, phone: '07000000000', email, location: 'HQ', role: 'Security Officer', rate: 14, address: 'x', nid: 'x'
  });
  if (status !== 201) throw new Error('create worker failed: ' + JSON.stringify(data));
  await api('POST', `/api/workers/${data.id}/reset-password`, { password: 'Test@1234' });
  return data.id;
}

async function main() {
  ADMIN = await login('ashraf.milon@gmail.com', 'Milon@1234');
  console.log('Admin login OK\n');

  /* ---- setup: 3 workers + a geofenced location ---- */
  for (let i = 1; i <= 3; i++) {
    workerIds.push(await makeWorker(`Bulk Tester ${i}`, `bulk${i}-${stamp}@test.com`));
  }
  const { data: locData } = await api('POST', '/api/locations', {
    name: `Bulk Site ${stamp}`, address: 'Test', latitude: 51.5007, longitude: -0.1246, radiusMeters: 500
  });
  locId = locData.id;
  console.log(`Setup: 3 workers, location ${locId}\n`);

  /* ---- 1. Bulk assign all 3 workers for TOMORROW ---- */
  console.log('=== BULK ASSIGN (single date) ===');
  const d1 = plusDays(1);
  const { status: s1, data: r1 } = await api('POST', '/api/assignments/bulk', {
    workerIds, locationId: locId, date: d1
  });
  check(s1 === 201, `Bulk assign 3 workers (${s1})`, JSON.stringify(r1));
  check(r1?.created === 3 && r1?.updated === 0, `created=3 updated=0`, JSON.stringify(r1));
  check(r1?.dates?.length === 1 && r1.dates[0] === d1, 'one date returned');

  const { data: rows } = await api('GET', `/api/assignments?date=${d1}`);
  const mine = rows.filter(r => workerIds.includes(r.workerId));
  check(mine.length === 3 && mine.every(r => r.locationId === locId),
    `All 3 workers appear on ${d1} assignments list`);

  /* ---- 2. Recurring weekly pattern ---- */
  console.log('\n=== RECURRING (weekly) ===');
  // Start next Monday, repeat every Monday for 4 weeks
  const start = new Date(); start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  const startIso = iso(start);
  const until = new Date(start); until.setDate(until.getDate() + 21); // 4 Mondays total
  const untilIso = iso(until);

  const { status: s2, data: r2 } = await api('POST', '/api/assignments/bulk', {
    workerIds: [workerIds[0]], locationId: locId,
    date: startIso, repeatWeekday: 1, repeatUntil: untilIso
  });
  check(s2 === 201, `Recurring bulk assign (${s2})`, JSON.stringify(r2));
  check(r2?.dates?.length === 4, `4 Monday dates created`, JSON.stringify(r2?.dates));
  check(r2?.dates?.every(d => new Date(d + 'T00:00:00').getDay() === 1), 'all dates are Mondays');

  for (const d of r2?.dates || []) {
    const { data: dayRows } = await api('GET', `/api/assignments?date=${d}`);
    check(dayRows.some(r => r.workerId === workerIds[0] && r.locationId === locId),
      `  assignment exists on ${d}`);
  }

  /* ---- 3. One audit log entry for the whole batch ---- */
  const { data: bulkLogs } = await api('GET', '/api/action-logs?action=bulk_assigned_workers');
  const bulkLog = bulkLogs?.find(l => l.targetId === locId && l.details?.dates?.includes(d1));
  check(!!bulkLog, 'single bulk_assigned_workers log entry exists');
  if (bulkLog) {
    check(bulkLog.details.workerIds?.length === 3 &&
      workerIds.every(id => bulkLog.details.workerIds.includes(id)),
      'all 3 worker IDs stored in one log entry');
  }

  /* ---- 4. Assignment visible in worker check-in flow (today) ---- */
  console.log('\n=== CHECK-IN MATCHES ASSIGNMENT ===');
  // Assign worker 1 to the geofenced site TODAY, then check in at its GPS coords
  await api('POST', '/api/assignments', { workerId: workerIds[0], locationId: locId, date: today() });
  const w1 = await workerLogin(workerIds[0], 'Test@1234');
  const { status: cs, data: cd } = await api('POST', '/api/worker/attendance/checkin',
    { latitude: 51.5007, longitude: -0.1246 }, w1);
  check(cs === 201, `Worker check-in at assigned site (${cs})`, JSON.stringify(cd));
  check(cd?.assignmentStatus === 'match', `assignment_status = match`, cd?.assignmentStatus);
  attId = cd?.id;
  if (attId) await api('POST', '/api/worker/attendance/checkout', {}, w1);

  // Worker 2 (no assignment today) checks in at same coords → 'none'
  const w2 = await workerLogin(workerIds[1], 'Test@1234');
  const { data: cd2 } = await api('POST', '/api/worker/attendance/checkin',
    { latitude: 51.5007, longitude: -0.1246 }, w2);
  check(cd2?.assignmentStatus === 'none', `unassigned worker gets 'none'`, cd2?.assignmentStatus);
  if (cd2?.id) await api('POST', '/api/worker/attendance/checkout', {}, w2);

  /* ---- 5. Single-assignment flow still works + is logged ---- */
  console.log('\n=== SINGLE ASSIGNMENT (regression) ===');
  const { status: s5, data: r5 } = await api('POST', '/api/assignments', {
    workerId: workerIds[2], locationId: locId, date: plusDays(2)
  });
  check(s5 === 201, `Single assign still works (${s5})`, JSON.stringify(r5));
  const { data: singleLogs } = await api('GET', '/api/action-logs?action=assigned_worker');
  check(singleLogs?.some(l => l.details?.workerId === workerIds[2]), 'assigned_worker logged');

  // Upsert: same worker+date → update in place, not a duplicate
  const { data: r6 } = await api('POST', '/api/assignments', {
    workerId: workerIds[2], locationId: locId, date: plusDays(2)
  });
  check(r6?.updated === true, 'Duplicate single assign updates in place');

  /* ---- 6. Validation ---- */
  const { status: sE1 } = await api('POST', '/api/assignments/bulk', { workerIds: [], locationId: locId, date: d1 });
  check(sE1 === 400, 'empty workerIds rejected');
  const { status: sE2 } = await api('POST', '/api/assignments/bulk', {
    workerIds, locationId: locId, date: d1, repeatUntil: '2020-01-01'
  });
  check(sE2 === 400, 'repeatUntil before start rejected');
  const { status: sE3 } = await api('POST', '/api/assignments/bulk', {
    workerIds, locationId: 'NOPE', date: d1
  });
  check(sE3 === 404, 'unknown location rejected');

  /* ---- cleanup ---- */
  console.log('\n=== CLEANUP ===');
  const pool = require('./config/database');
  const ph = workerIds.map(() => '?').join(',');
  await pool.query(`DELETE FROM worker_location_assignments WHERE worker_id IN (${ph})`, workerIds);
  await pool.query(`DELETE FROM attendance WHERE worker_id IN (${ph})`, workerIds);
  for (const wid of workerIds) {
    await pool.query('DELETE FROM users WHERE worker_id = ?', [wid]);
    await pool.query('DELETE FROM workers WHERE id = ?', [wid]);
  }
  await pool.query('DELETE FROM locations WHERE id = ?', [locId]);
  console.log('Test assignments, attendance, workers, location removed.');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
