// Phase D test: subcontract company, worker type, country, document fields
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

const BASE = 'http://localhost:3001';
let TOKEN = '';
let appId = '';
let workerId = '';

async function api(method, url, body, isForm = false) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: isForm ? { Authorization: `Bearer ${TOKEN}` } : { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
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

  // 1. Submit with Sub-contract source + non-UK passport + visa + SIA
  console.log('=== SUBMIT: Sub-contract + non-UK passport + docs ===');
  const fd = new FormData();
  fd.append('title', 'Mr'); fd.append('surname', 'Subbie'); fd.append('forename', 'Test');
  fd.append('dob', '1990-01-15'); fd.append('mobile', '+44 7700 900100');
  fd.append('email', `phased-${Date.now()}@test.com`);
  fd.append('addr1', '10 Sub Street'); fd.append('town', 'London');
  fd.append('postcode', 'E3 3CC'); fd.append('country', 'United Kingdom');
  fd.append('birthPlace', 'Berlin'); fd.append('nationality', 'German');
  fd.append('ni', 'CC 33 44 55 D'); fd.append('rtw', 'Yes');
  fd.append('rate', '16.00');
  fd.append('prefLocations', JSON.stringify(['Stratford Yard']));
  fd.append('hasVisa', 'Yes'); fd.append('visaType', 'Skilled Worker');
  // Phase D fields
  fd.append('howHeard', 'Sub-contract');
  fd.append('subcontractCompany', 'ABC Security Subcontractors Ltd');
  fd.append('passportCountry', 'Germany');
  fd.append('passportNumber', 'C01X00T47');
  fd.append('passportExpiry', '2030-11-30');
  fd.append('visaNumber', 'SWV-445566');
  fd.append('visaExpiry', '2028-02-14');
  fd.append('siaBadgeNumber', 'SIA-112233');
  fd.append('siaBadgeExpiry', '2027-09-15');
  fd.append('prevAddresses', '[]'); fd.append('employers', '[]');
  fd.append('referees', '[]'); fd.append('skills', '[]');

  const { status: s1, data: d1 } = await api('POST', '/api/applications', fd, true);
  console.log('Submit status:', s1);
  if (s1 !== 201) { console.log('FAIL:', JSON.stringify(d1)); process.exit(1); }
  appId = d1.id;
  console.log('App ID:', appId);

  // 2. Verify application list/detail shows all new fields
  console.log('\n=== VERIFY APPLICATION DATA ===');
  const { data: apps } = await api('GET', '/api/applications');
  const app = apps.find(a => a.id === appId);
  if (!app) { console.log('FAIL: app not in list'); process.exit(1); }
  const checks = [
    ['howHeard', 'Sub-contract', app.howHeard],
    ['subcontractCompany', 'ABC Security Subcontractors Ltd', app.subcontractCompany],
    ['workerType', 'Sub-contract', app.workerType],
    ['passportCountry', 'Germany', app.passportCountry],
    ['passportNumber', 'C01X00T47', app.passportNumber],
    ['visaNumber', 'SWV-445566', app.visaNumber],
    ['siaBadgeNumber', 'SIA-112233', app.siaBadgeNumber],
  ];
  let ok = true;
  for (const [k, exp, act] of checks) {
    const pass = act === exp;
    if (!pass) ok = false;
    console.log(`${pass ? 'OK' : 'FAIL'} ${k}: "${act}" (expected "${exp}")`);
  }
  console.log(`  passportExpiry: "${app.passportExpiry}"`);
  console.log(`  visaExpiry: "${app.visaExpiry}"`);
  console.log(`  siaBadgeExpiry: "${app.siaBadgeExpiry}"`);

  // 3. Approve + setup password → verify worker carry-over
  console.log('\n=== APPROVE + SETUP ===');
  const { status: as } = await api('POST', `/api/applications/${appId}/approve`, { rate: 16 });
  console.log('Approve:', as);
  if (as !== 200) { console.log('FAIL approve'); process.exit(1); }

  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const [tok] = await pool.query('SELECT approval_token FROM registration_applications WHERE id = ?', [appId]);
  const { status: sps, data: spd } = await api('POST', '/api/auth/setup-password', { token: tok[0].approval_token, password: 'SubTest@123' });
  console.log('Setup:', sps, '| worker:', spd.workerId);
  workerId = spd.workerId;
  await pool.end();

  // 4. Verify worker record
  console.log('\n=== VERIFY WORKER RECORD ===');
  const { data: wlist } = await api('GET', '/api/workers');
  const w = wlist.find(x => x.id === workerId);
  if (!w) { console.log('FAIL: worker not found'); process.exit(1); }
  const wChecks = [
    ['workerType', 'Sub-contract', w.workerType],
    ['subcontractCompany', 'ABC Security Subcontractors Ltd', w.subcontractCompany],
    ['passportCountry', 'Germany', w.passportCountry],
    ['passportNumber', 'C01X00T47', w.passportNumber],
    ['visaNumber', 'SWV-445566', w.visaNumber],
    ['siaBadgeNumber', 'SIA-112233', w.siaBadgeNumber],
  ];
  for (const [k, exp, act] of wChecks) {
    const pass = act === exp;
    if (!pass) ok = false;
    console.log(`${pass ? 'OK' : 'FAIL'} worker.${k}: "${act}" (expected "${exp}")`);
  }

  // 5. Submit a Direct application (UK passport, no visa) — should still work
  console.log('\n=== SUBMIT: Direct / UK / blank new fields ===');
  const fd2 = new FormData();
  fd2.append('title', 'Ms'); fd2.append('surname', 'Direct'); fd2.append('forename', 'Plain');
  fd2.append('dob', '1996-06-10'); fd2.append('mobile', '+44 7700 900200');
  fd2.append('email', `direct-${Date.now()}@test.com`);
  fd2.append('addr1', '5 Direct Road'); fd2.append('town', 'London');
  fd2.append('postcode', 'E4 4DD'); fd2.append('country', 'United Kingdom');
  fd2.append('birthPlace', 'London'); fd2.append('nationality', 'British');
  fd2.append('ni', 'DD 44 55 66 E'); fd2.append('rtw', 'Yes');
  fd2.append('rate', '13.00');
  fd2.append('prefLocations', JSON.stringify(['Camden Site']));
  fd2.append('hasVisa', 'No');
  fd2.append('howHeard', 'Other');
  fd2.append('passportCountry', 'United Kingdom');
  fd2.append('prevAddresses', '[]'); fd2.append('employers', '[]');
  fd2.append('referees', '[]'); fd2.append('skills', '[]');
  const { status: s2, data: d2 } = await api('POST', '/api/applications', fd2, true);
  console.log('Blank/Direct submit:', s2);
  if (s2 === 201) {
    const { data: apps2 } = await api('GET', '/api/applications');
    const app2 = apps2.find(a => a.id === d2.id);
    console.log(`  workerType: "${app2?.workerType}" (expected "Direct")`);
    console.log(`  subcontractCompany: "${app2?.subcontractCompany}" (expected null/empty)`);
    console.log(`  howHeard: "${app2?.howHeard}"`);
    if (app2?.workerType !== 'Direct') { ok = false; console.log('FAIL: workerType should be Direct'); }
  } else {
    ok = false;
    console.log('FAIL: blank submission rejected');
  }

  // 6. Smoke tests
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],
    ['/api/payroll','Payroll'],['/api/payroll/summary?period=weekly','Weekly Summary'],
    ['/api/payroll/summary?period=monthly','Monthly Summary'],['/api/payroll/summary?period=yearly','Yearly Summary'],
    ['/api/locations','Locations'],['/api/buyer-income','Buyer Income'],['/api/other-costs','Other Costs'],
    ['/api/reports/dashboard','Reports'],['/api/settings','Settings'],
    ['/api/settings/bank-holidays','Bank Holidays'],['/api/applications','Applications'],
    ['/api/notifications','Notifications'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
  }

  console.log(`\n${ok ? '✅ ALL PHASE D TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
