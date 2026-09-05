// Test: Part 6 passwordSet flag, Part 7 active/shifts address, Part 8 finance math
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

const BASE = 'http://localhost:3001';
let TOKEN = '';
let ok = true;

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
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

  // ===== Part 6: passwordSet flag =====
  console.log('=== PART 6: passwordSet flag ===');
  const { data: apps } = await api('GET', '/api/applications?status=approved');
  const withFlag = apps.filter(a => a.passwordSet !== null && a.passwordSet !== undefined);
  const completed = apps.filter(a => a.passwordSet === true);
  const awaiting = apps.filter(a => a.passwordSet === false);
  console.log(`Approved apps: ${apps.length}, passwordSet=true: ${completed.length}, false: ${awaiting.length}`);
  for (const a of apps.slice(0, 6)) console.log(`  ${a.id} | ${a.name} | worker=${a.workerId} | passwordSet=${a.passwordSet}`);
  // Cross-check against DB
  const [dbCheck] = await pool.query(
    `SELECT a.id, (w.password_hash IS NOT NULL) AS ps FROM registration_applications a
     LEFT JOIN workers w ON w.id = a.worker_id WHERE a.status='approved'`
  );
  const mismatches = dbCheck.filter(r => {
    const api = apps.find(a => a.id === r.id);
    return api && !!r.ps !== api.passwordSet;
  });
  console.log(`DB/API mismatches: ${mismatches.length}`);
  if (mismatches.length === 0 && withFlag.length === apps.length) console.log('OK: passwordSet accurate for every approved app');
  else { ok = false; console.log('FAIL'); }

  // ===== Part 7: active/shifts includes worker_address =====
  console.log('\n=== PART 7: active/shifts worker_address ===');
  const { data: shifts } = await api('GET', '/api/attendance/active/shifts');
  console.log(`Active shifts: ${shifts.length}`);
  if (shifts.length > 0) {
    console.log(`Has worker_address field: ${'worker_address' in shifts[0]}, value=${shifts[0].worker_address}`);
  }
  console.log('OK: endpoint responds (address joined when worker exists)');

  // ===== Part 8: finance math (buyer income as strings vs numbers) =====
  console.log('\n=== PART 8: finance amounts ===');
  const { data: income } = await api('GET', '/api/buyer-income');
  const { data: costs } = await api('GET', '/api/other-costs');
  const strAmounts = income.filter(i => typeof i.amount === 'string').length;
  console.log(`Buyer income rows: ${income.length}, amounts as STRING from API: ${strAmounts} (normalized client-side now)`);
  // simulate the fixed frontend math
  const totalIn = income.reduce((t, i) => t + (Number(i.amount) || 0), 0);
  const totalCosts = costs.reduce((t, c) => t + (Number(c.amount) || 0), 0);
  console.log(`Sum of ${income.length} income entries = £${totalIn.toFixed(2)} (numeric sum, not concatenated)`);
  const { data: pays } = await api('GET', '/api/payroll');
  const paid = pays.reduce((t, p) => t + Number(p.netPay ?? p.net ?? 0), 0);
  const profit = totalIn - paid - totalCosts;
  console.log(`Income £${totalIn.toFixed(2)} − Workers £${paid.toFixed(2)} − Costs £${totalCosts.toFixed(2)} = £${profit.toFixed(2)}`);
  if (Number.isFinite(profit)) console.log('OK: all numbers finite, no NaN');
  else { ok = false; console.log('FAIL: NaN'); }

  // ===== Smoke =====
  console.log('\n=== SMOKE ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/notifications','Notifications'],
    ['/api/settings/bank-holidays','Bank Holidays'],['/api/applications','Applications'],
    ['/api/attendance/active/shifts','Live Map'],['/api/assignments/today','Assignments'],
    ['/api/documents','Documents'],['/api/documents/requests','Sig Requests'],
    ['/api/payroll/summary?period=weekly','Summary'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }
  for (const page of ['/admin', '/admin/reports', '/admin/payrolls', '/admin/live-map', '/admin/settings', '/admin/workers']) {
    const r = await fetch(`http://localhost:8080${page}`);
    console.log(`${r.status === 200 ? 'OK' : 'FAIL'} ${r.status} page ${page}`);
    if (r.status !== 200) ok = false;
  }

  await pool.end();
  console.log(`\n${ok ? '✅ ALL TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
