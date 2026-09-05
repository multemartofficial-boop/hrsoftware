// Visa-expiry hard block test (Phase D continuation)
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
  // Admin login
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

  const workerId = 'WKR-2026-0154';
  const workerPass = 'SubTest@123';

  const workerLogin = async () => {
    const r = await fetch(`${BASE}/api/auth/worker/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerCode: workerId, password: workerPass })
    });
    const data = await r.json();
    if (!data.token) throw new Error('Worker login failed: ' + JSON.stringify(data));
    return data.token;
  };

  const workerCheckIn = async (token, location = 'Stratford Yard') => {
    const r = await fetch(`${BASE}/api/worker/attendance/checkin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ location })
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  const getToday = async (token) => {
    const r = await fetch(`${BASE}/api/worker/attendance/today`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return r.json();
  };

  const wToken = await workerLogin();
  console.log(`Worker login OK (${workerId})\n`);

  // Ensure clean state: check out any active record + clear today's attendance for clean tests
  const todayStr = new Date().toISOString().split('T')[0];
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [workerId, todayStr]);

  // ===== TEST 1: Expired visa → blocked =====
  console.log('=== TEST 1: EXPIRED VISA → BLOCKED ===');
  const past = new Date(); past.setDate(past.getDate() - 10);
  await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [past.toISOString().slice(0, 10), workerId]);

  const today1 = await getToday(wToken);
  console.log(`/today visaExpired flag: ${today1.visaExpired} (expected true)`);
  if (today1.visaExpired !== true) { ok = false; console.log('FAIL: visaExpired not true'); }

  const c1 = await workerCheckIn(wToken);
  console.log(`check-in attempt: status=${c1.status} — "${c1.data?.error}"`);
  if (c1.status === 403 && /visa/i.test(c1.data?.error || '')) {
    console.log('OK: server-side block with visa error message');
  } else { ok = false; console.log('FAIL: expected 403 visa error'); }

  // Admin view: worker list should show the worker with visa_expiry past → status check via workers API
  // (The "Visa Expired" badge is computed client-side via workerStatus; verify visaExpiry is exposed)
  const { data: workers } = await api('GET', '/api/workers');
  const w = workers.find(x => x.id === workerId);
  const visaDays = Math.round((new Date(w.visaExpiry) - new Date(todayStr + 'T00:00:00')) / 86400000);
  console.log(`Admin workers API: visaExpiry=${w.visaExpiry} → daysUntil=${visaDays} (should be <= 0 → "Visa Expired" badge)`);
  if (!(visaDays <= 0)) { ok = false; console.log('FAIL: visa not past in admin data'); }
  else console.log('OK: admin will see "Visa Expired" badge (daysUntil <= 0)');

  // ===== TEST 2: Future visa → check-in works =====
  console.log('\n=== TEST 2: FUTURE VISA → ALLOWED ===');
  const future = new Date(); future.setDate(future.getDate() + 200);
  await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [future.toISOString().slice(0, 10), workerId]);

  const today2 = await getToday(wToken);
  console.log(`/today visaExpired flag: ${today2.visaExpired} (expected false)`);
  if (today2.visaExpired !== false) { ok = false; console.log('FAIL: visaExpired should be false'); }

  const c2 = await workerCheckIn(wToken);
  console.log(`check-in attempt: status=${c2.status} — ${c2.data?.message || c2.data?.error}`);
  if (c2.status === 201) console.log('OK: check-in allowed with future visa');
  else { ok = false; console.log('FAIL: check-in should succeed'); }
  // Check out to reset
  await fetch(`${BASE}/api/worker/attendance/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wToken}` }, body: '{}'
  });
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [workerId, todayStr]);

  // ===== TEST 3: No visa on file → unaffected =====
  console.log('\n=== TEST 3: NO VISA ON FILE → UNAFFECTED ===');
  await pool.query('UPDATE workers SET visa_expiry = NULL WHERE id = ?', [workerId]);

  const today3 = await getToday(wToken);
  console.log(`/today visaExpired flag: ${today3.visaExpired} (expected false)`);
  if (today3.visaExpired !== false) { ok = false; console.log('FAIL: visaExpired should be false'); }

  const c3 = await workerCheckIn(wToken);
  console.log(`check-in attempt: status=${c3.status} — ${c3.data?.message || c3.data?.error}`);
  if (c3.status === 201) console.log('OK: check-in allowed with no visa on file');
  else { ok = false; console.log('FAIL: check-in should succeed'); }
  await fetch(`${BASE}/api/worker/attendance/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wToken}` }, body: '{}'
  });
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [workerId, todayStr]);

  // ===== TEST 4: 90-day warning notifications still work =====
  console.log('\n=== TEST 4: 90-DAY WARNING NOTIFICATIONS INTACT ===');
  const soon = new Date(); soon.setDate(soon.getDate() + 45);
  await pool.query('UPDATE workers SET visa_expiry = ? WHERE id = ?', [soon.toISOString().slice(0, 10), workerId]);
  const { data: notices } = await api('GET', '/api/notifications/expiry');
  const visaNotice = notices.find(n => n.id === `VISA-${workerId}`);
  if (visaNotice && visaNotice.category === 'visa') {
    console.log(`OK: warning notice present — "${visaNotice.message}"`);
  } else { ok = false; console.log('FAIL: visa warning notice missing'); }

  // ===== TEST 5: Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/workers/' + workerId + '/compliance','Compliance'],
    ['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/payroll/summary?period=weekly','Weekly'],['/api/payroll/summary?period=monthly','Monthly'],
    ['/api/payroll/summary?period=yearly','Yearly'],['/api/locations','Locations'],
    ['/api/buyer-income','Buyer Income'],['/api/other-costs','Other Costs'],
    ['/api/reports/dashboard','Reports'],['/api/settings','Settings'],
    ['/api/settings/bank-holidays','Bank Holidays'],['/api/applications','Applications'],
    ['/api/notifications','Notifications'],['/api/notifications/expiry','Expiry Notices'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  // Cleanup
  await pool.query('UPDATE workers SET visa_expiry = NULL WHERE id = ?', [workerId]);
  await pool.query('DELETE FROM notifications WHERE id LIKE ?', [`VISA-${workerId}-%`]);
  await pool.end();

  console.log(`\n${ok ? '✅ ALL VISA-BLOCK TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
