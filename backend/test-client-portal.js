// Phase 4 test: Client portal
// Admin creates a client -> client logs in -> sees ONLY their own
// locations/schedule/billing; locked out of admin & worker APIs.
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

async function clientLogin(email, password) {
  const res = await fetch(`${BASE}/api/auth/client/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const d = await res.json();
  return { status: res.status, token: d.token, user: d.user };
}

async function workerLogin(workerCode, password) {
  const res = await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode, password })
  });
  const d = await res.json();
  if (!d.token) throw new Error(`Worker login failed: ` + JSON.stringify(d));
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

let locId, otherLocId, workerId, attId, clientId;
const CLIENT_EMAIL = `client-${stamp}@acme.test`;
const BUYER = `Acme Test ${stamp}`;
const OTHER_BUYER = `Other Buyer ${stamp}`;

async function main() {
  ADMIN = await login('ashraf.milon@gmail.com', 'Milon@1234');
  console.log('Admin login OK\n');

  /* ---- setup: two locations (one theirs, one NOT), a worker, buyer income ---- */
  const { data: l1 } = await api('POST', '/api/locations', {
    name: `Client Site ${stamp}`, address: 'Client HQ', latitude: 51.5007, longitude: -0.1246, radiusMeters: 500
  });
  locId = l1.id;
  const { data: l2 } = await api('POST', '/api/locations', {
    name: `Other Site ${stamp}`, address: 'Not theirs', latitude: 52.0, longitude: -1.0, radiusMeters: 500
  });
  otherLocId = l2.id;

  const { data: w } = await api('POST', '/api/workers', {
    name: 'Portal Test Worker', phone: '07000000000', email: `pw-${stamp}@test.com`,
    location: 'HQ', role: 'Security Officer', rate: 14, address: 'x', nid: 'x'
  });
  workerId = w.id;
  await api('POST', `/api/workers/${workerId}/reset-password`, { password: 'Test@1234' });

  const pool = require('./config/database');
  await pool.query(
    'INSERT INTO buyer_income (id, buyer_name, description, amount, date, status) VALUES (?, ?, ?, ?, ?, ?)',
    [`BI-${stamp}-1`, BUYER, 'Site security — week 1', 1200, today(), 'Received']);
  await pool.query(
    'INSERT INTO buyer_income (id, buyer_name, description, amount, date, status) VALUES (?, ?, ?, ?, ?, ?)',
    [`BI-${stamp}-2`, BUYER, 'Site security — week 2', 1450, today(), 'Pending']);
  await pool.query(
    'INSERT INTO buyer_income (id, buyer_name, description, amount, date, status) VALUES (?, ?, ?, ?, ?, ?)',
    [`BI-${stamp}-3`, OTHER_BUYER, 'Someone elses invoice', 9999, today(), 'Pending']);

  /* ---- 1. Admin creates client ---- */
  console.log('=== ADMIN CREATES CLIENT ===');
  const { status: s1, data: d1 } = await api('POST', '/api/clients', {
    name: 'Jane Client', company: 'Acme Facilities', email: CLIENT_EMAIL,
    password: 'Client@1234', buyerName: BUYER, locationIds: [locId],
  });
  check(s1 === 201, `Create client (${s1})`, JSON.stringify(d1));
  clientId = d1?.id;

  // duplicate email rejected
  const { status: sDup } = await api('POST', '/api/clients', {
    name: 'Dup', company: 'Dup', email: CLIENT_EMAIL, password: 'xxxxxx', locationIds: []
  });
  check(sDup === 400, 'Duplicate email rejected (400)');

  const { data: clients } = await api('GET', '/api/clients');
  const cl = clients?.find(c => c.id === clientId);
  check(!!cl && cl.locations.length === 1 && cl.locations[0].id === locId, 'Client listed with linked location');
  check(cl?.buyerName === BUYER, `buyer_name = "${BUYER}"`);

  /* ---- 2. Client login ---- */
  console.log('\n=== CLIENT LOGIN ===');
  const { status: sl, token: ctok, user: cuser } = await clientLogin(CLIENT_EMAIL, 'Client@1234');
  check(sl === 200 && !!ctok, `Client login (${sl})`);
  check(cuser?.role === 'client' && cuser?.clientId === clientId, `JWT role=client, clientId=${clientId}`);

  const badLogin = await clientLogin(CLIENT_EMAIL, 'wrongpass');
  check(badLogin.status === 401, 'Wrong password rejected (401)');

  /* ---- 3. Scoped portal data ---- */
  console.log('\n=== PORTAL DATA SCOPING ===');
  const { data: me } = await api('GET', '/api/client/me', null, ctok);
  check(me?.email === CLIENT_EMAIL && me?.locations?.length === 1 && me.locations[0].id === locId,
    'Client sees only their linked location');

  // Assign worker to BOTH locations today; client should only see theirs
  await api('POST', '/api/assignments', { workerId, locationId: locId, date: today() });

  const { data: ov } = await api('GET', '/api/client/overview', null, ctok);
  check(ov?.scheduledToday === 1, `overview.scheduledToday = 1 (their site only)`, JSON.stringify(ov?.scheduledToday));

  // Worker checks in at the client site -> shows up in checkedInNow
  const wtok = await workerLogin(workerId, 'Test@1234');
  const { data: cd } = await api('POST', '/api/worker/attendance/checkin',
    { latitude: 51.5007, longitude: -0.1246 }, wtok);
  attId = cd?.id;
  check(cd?.assignmentStatus === 'match', 'Worker check-in matches client site assignment');

  const { data: ov2 } = await api('GET', '/api/client/overview', null, ctok);
  check(ov2?.checkedInCount === 1 && ov2.checkedInNow[0]?.worker === 'Portal Test Worker',
    `checkedInNow shows the worker (${ov2?.checkedInCount})`);

  const { data: sched } = await api('GET', '/api/client/schedule', null, ctok);
  const todayRow = sched?.find(r => r.date === today());
  check(!!todayRow && todayRow.location === `Client Site ${stamp}` && todayRow.status === 'on_site',
    'Schedule shows today assignment as on_site at their location');
  check(sched?.every(r => r.location !== `Other Site ${stamp}`), 'Schedule NEVER shows the other location');
  // No worker PII beyond the name
  const rowKeys = todayRow ? Object.keys(todayRow).sort().join(',') : '';
  check(!sched?.some(r => 'email' in r || 'phone' in r || 'rate' in r || 'nid' in r),
    `No worker PII in schedule (keys: ${rowKeys})`);

  const { data: bill } = await api('GET', '/api/client/billing', null, ctok);
  check(bill?.entries?.length === 2 && bill.entries.every(e => e.amount !== 9999),
    `Billing shows only their buyer rows (${bill?.entries?.length})`);
  check(bill?.totals?.received === 1200 && bill?.totals?.pending === 1450,
    `Totals received=1200 pending=1450`);

  /* ---- 4. Access control ---- */
  console.log('\n=== ACCESS CONTROL ===');
  const r1 = await api('GET', '/api/workers', null, ctok);
  check(r1.status === 403, `Client -> /api/workers denied (${r1.status})`);
  const r2 = await api('GET', '/api/incidents', null, ctok);
  check(r2.status === 403, `Client -> /api/incidents denied (${r2.status})`);
  const r3 = await api('GET', '/api/payroll', null, ctok);
  check(r3.status === 403, `Client -> /api/payroll denied (${r3.status})`);
  const r4 = await api('GET', '/api/client/me', null, wtok);
  check(r4.status === 403, `Worker -> /api/client denied (${r4.status})`);
  const r5 = await fetch(`${BASE}/api/client/me`); // truly unauthenticated
  check(r5.status === 401, `No token -> /api/client denied (${r5.status})`);
  const r6 = await api('GET', '/api/clients', null, ctok);
  check(r6.status === 403, `Client -> /api/clients admin list denied (${r6.status})`);

  /* ---- 5. Action log ---- */
  const { data: logs } = await api('GET', '/api/action-logs?action=created_client');
  check(logs?.some(l => l.targetId === clientId), 'created_client logged to Action History');

  /* ---- 6. Update / reset / delete lifecycle ---- */
  console.log('\n=== LIFECYCLE ===');
  const { status: s6 } = await api('PUT', `/api/clients/${clientId}`, {
    name: 'Jane Client', company: 'Acme Facilities', email: CLIENT_EMAIL,
    buyerName: BUYER, locationIds: [locId, otherLocId]
  });
  check(s6 === 200, `Update client locations (${s6})`);
  const { data: me2 } = await api('GET', '/api/client/me', null, ctok);
  check(me2?.locations?.length === 2, 'Client now sees 2 locations after update');

  await api('POST', `/api/clients/${clientId}/reset-password`, { password: 'NewPass@99' });
  const relogin = await clientLogin(CLIENT_EMAIL, 'NewPass@99');
  check(relogin.status === 200, 'Login works after admin reset-password');
  const oldTok = await clientLogin(CLIENT_EMAIL, 'Client@1234');
  check(oldTok.status === 401, 'Old password no longer works');

  const { status: sDel } = await api('DELETE', `/api/clients/${clientId}`);
  check(sDel === 200, `Delete client (${sDel})`);
  const goneLogin = await clientLogin(CLIENT_EMAIL, 'NewPass@99');
  check(goneLogin.status === 401, 'Deleted client cannot log in');

  /* ---- cleanup ---- */
  console.log('\n=== CLEANUP ===');
  await pool.query('DELETE FROM attendance WHERE id = ?', [attId]);
  await pool.query('DELETE FROM worker_location_assignments WHERE worker_id = ?', [workerId]);
  await pool.query('DELETE FROM users WHERE worker_id = ?', [workerId]);
  await pool.query('DELETE FROM workers WHERE id = ?', [workerId]);
  await pool.query('DELETE FROM locations WHERE id IN (?, ?)', [locId, otherLocId]);
  await pool.query('DELETE FROM buyer_income WHERE buyer_name IN (?, ?)', [BUYER, OTHER_BUYER]);
  console.log('Test data removed.');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
