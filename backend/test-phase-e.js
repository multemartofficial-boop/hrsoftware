// Phase E test: BS7858 compliance checklist + visa expiry alerts
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

const BASE = 'http://localhost:3001';
let TOKEN = '';

async function api(method, url, body, token = TOKEN) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Login failed');
  TOKEN = d.token;
  console.log('Login OK\n');
}

async function main() {
  await login();
  let ok = true;

  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });

  // Find the test worker from Phase D (WKR-2026-0154) or any worker
  const { data: workers } = await api('GET', '/api/workers');
  const testWorker = workers.find(w => w.id === 'WKR-2026-0154') || workers[0];
  if (!testWorker) { console.log('No workers to test'); process.exit(1); }
  const wid = testWorker.id;
  console.log(`Test worker: ${testWorker.name} (${wid})\n`);

  // ===== PART 1: COMPLIANCE CHECKLIST =====
  console.log('=== PART 1: COMPLIANCE CHECKLIST ===');

  // GET initial state
  const { status: g1s, data: c1 } = await api('GET', `/api/workers/${wid}/compliance`);
  console.log(`GET compliance: ${g1s}, checks=${c1?.checks?.length}, complete=${c1?.complete}/${c1?.total}`);
  const allNotStarted = c1?.checks?.every(c => c.status === 'not_started');
  console.log(allNotStarted ? 'OK: all 8 start as not_started' : 'FAIL: initial state');

  // PUT some items: mark 3 complete, 1 in_progress, set criminal level + notes
  const upd = c1.checks.map(c => {
    if (c.key === 'electronicId') return { ...c, status: 'complete', completedDate: '2026-09-01', notes: 'Verified via Onfido' };
    if (c.key === 'rightToWork') return { ...c, status: 'complete', completedDate: '2026-09-02', notes: 'Share code checked' };
    if (c.key === 'criminalRecords') return { ...c, status: 'in_progress', level: 'Enhanced', notes: 'DBS submitted' };
    if (c.key === 'addressHistory') return { ...c, status: 'complete', completedDate: '2026-09-01', notes: '3 proofs checked' };
    return c;
  });
  const { status: p1s, data: c2 } = await api('PUT', `/api/workers/${wid}/compliance`, { checks: upd });
  console.log(`PUT compliance: ${p1s}, complete=${c2?.complete}/${c2?.total}`);
  if (c2?.complete !== 3 || c2?.total !== 8) { ok = false; console.log('FAIL: expected 3/8 complete'); }
  else console.log('OK: 3/8 complete after save');

  // Verify persistence + fields
  const { data: c3 } = await api('GET', `/api/workers/${wid}/compliance`);
  const cr = c3.checks.find(c => c.key === 'criminalRecords');
  const eid = c3.checks.find(c => c.key === 'electronicId');
  console.log(`criminalRecords: status=${cr.status}, level=${cr.level}, notes="${cr.notes}"`);
  console.log(`electronicId: status=${eid.status}, date=${eid.completedDate}, notes="${eid.notes}"`);
  if (cr.level !== 'Enhanced' || eid.notes !== 'Verified via Onfido') { ok = false; console.log('FAIL: fields not persisted'); }
  else console.log('OK: level + notes + dates persisted');

  // Workers list should now show complianceDone=3 for this worker
  const { data: w2 } = await api('GET', '/api/workers');
  const wu = w2.find(w => w.id === wid);
  console.log(`Directory complianceDone: ${wu?.complianceDone} (expected 3)`);
  if (wu?.complianceDone !== 3) { ok = false; console.log('FAIL: directory count'); }
  else console.log('OK: directory shows 3/8');

  // ===== PART 2: VISA EXPIRY ALERTS =====
  console.log('\n=== PART 2: VISA EXPIRY ALERTS ===');

  // 2a. Worker with visa within 90 days → notice appears
  const soon = new Date(); soon.setDate(soon.getDate() + 45);
  const soonStr = soon.toISOString().slice(0, 10);
  await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [soonStr, wid]);
  console.log(`Set ${wid} visa_expiry = ${soonStr} (45 days away)`);

  const { data: notices } = await api('GET', '/api/notifications/expiry');
  const visaNotice = notices.find(n => n.id === `VISA-${wid}`);
  console.log(`Expiry notices count: ${notices.length}`);
  if (visaNotice) {
    console.log(`OK: visa notice found — "${visaNotice.message}" urgency=${visaNotice.urgency} category=${visaNotice.category}`);
    if (visaNotice.category !== 'visa') { ok = false; console.log('FAIL: missing visa category'); }
  } else {
    ok = false;
    console.log('FAIL: no visa notice for 45-day expiry');
  }

  // 2b. Worker with visa > 90 days → no notice
  const far = new Date(); far.setDate(far.getDate() + 200);
  const farStr = far.toISOString().slice(0, 10);
  await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [farStr, wid]);
  console.log(`Set ${wid} visa_expiry = ${farStr} (200 days away)`);
  const { data: notices2 } = await api('GET', '/api/notifications/expiry');
  const visaNotice2 = notices2.find(n => n.id === `VISA-${wid}`);
  if (!visaNotice2) {
    console.log('OK: no visa notice for 200-day expiry');
  } else {
    ok = false;
    console.log('FAIL: visa notice appeared for >90 day expiry');
  }

  // 2c. Worker with no visa → no notice
  await pool.query('UPDATE workers SET visa_expiry = NULL WHERE id = ?', [wid]);
  const { data: notices3 } = await api('GET', '/api/notifications/expiry');
  const visaNotice3 = notices3.find(n => n.id === `VISA-${wid}`);
  if (!visaNotice3) {
    console.log('OK: no visa notice when visa_expiry is NULL');
  } else {
    ok = false;
    console.log('FAIL: visa notice appeared with NULL expiry');
  }

  // 2d. Daily check: run checkExpiringWorkers with a visa 30 days out → persistent notification
  await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [soonStr, wid]);
  // First delete any prior notification with this id so we can observe creation
  await pool.query("DELETE FROM notifications WHERE id LIKE ?", [`VISA-${wid}-%`]);
  const { checkExpiringWorkers } = require('./utils/expiry');
  await checkExpiringWorkers();
  const [persisted] = await pool.query("SELECT * FROM notifications WHERE id LIKE ?", [`VISA-${wid}-%`]);
  if (persisted.length > 0 && persisted[0].message.includes('Visa')) {
    console.log(`OK: daily check created persistent visa notification: "${persisted[0].message}"`);
  } else {
    // 45 days isn't a threshold mark — that's expected
    console.log(`Note: 45 days is not a threshold mark [90,60,30,14,7,3,1,0] — no persistent notification expected`);
    // Try a threshold mark
    const t30 = new Date(); t30.setDate(t30.getDate() + 30);
    await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [t30.toISOString().slice(0, 10), wid]);
    await pool.query("DELETE FROM notifications WHERE id LIKE ?", [`VISA-${wid}-%`]);
    await checkExpiringWorkers();
    const [p2] = await pool.query("SELECT * FROM notifications WHERE id LIKE ?", [`VISA-${wid}-%`]);
    if (p2.length > 0) {
      console.log(`OK: daily check created persistent notification at 30-day mark: "${p2[0].message}"`);
      // Re-run should dedupe
      await checkExpiringWorkers();
      const [p3] = await pool.query("SELECT * FROM notifications WHERE id LIKE ?", [`VISA-${wid}-%`]);
      console.log(p3.length === p2.length ? 'OK: dedupe works — no duplicate notifications' : `FAIL: ${p3.length} vs ${p2.length} notifications`);
    } else {
      ok = false;
      console.log('FAIL: no persistent visa notification at threshold mark');
    }
  }

  // 2e. Workers cannot access compliance endpoints
  console.log('\n=== WORKER ACCESS CONTROL ===');
  const wlogin = await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerId: 'WKR-2026-0154', password: 'SubTest@123' })
  }).then(r => r.json());
  if (wlogin?.token) {
    const { status } = await api('GET', `/api/workers/${wid}/compliance`, undefined, wlogin.token);
    console.log(`${status === 403 || status === 401 ? 'OK' : 'FAIL'} worker token → compliance: ${status}`);
    if (status !== 403 && status !== 401) ok = false;
  } else {
    console.log('Worker login failed — cannot test access control');
  }

  // ===== SMOKE TESTS =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],
    ['/api/payroll','Payroll'],['/api/payroll/summary?period=weekly','Weekly'],
    ['/api/payroll/summary?period=monthly','Monthly'],['/api/payroll/summary?period=yearly','Yearly'],
    ['/api/locations','Locations'],['/api/buyer-income','Buyer Income'],['/api/other-costs','Other Costs'],
    ['/api/reports/dashboard','Reports'],['/api/settings','Settings'],
    ['/api/settings/bank-holidays','Bank Holidays'],['/api/applications','Applications'],
    ['/api/notifications','Notifications'],['/api/notifications/expiry','Expiry Notices'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  // Restore test worker visa_expiry
  await pool.query('UPDATE workers SET visa_expiry = NULL WHERE id = ?', [wid]);
  await pool.query("DELETE FROM notifications WHERE id LIKE ?", [`VISA-${wid}-%`]);
  await pool.end();

  console.log(`\n${ok ? '✅ ALL PHASE E TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
