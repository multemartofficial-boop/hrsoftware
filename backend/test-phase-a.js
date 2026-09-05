// Phase A end-to-end test: new registration fields, compliance checklist, worker carry-over
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE = 'http://localhost:3001';
let TOKEN = '';
let testAppId = '';
let testWorkerId = '';

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function api(method, url, body, isForm = false) {
  const opts = { method, headers: isForm ? { Authorization: `Bearer ${TOKEN}` } : headers() };
  if (body) opts.body = isForm ? body : JSON.stringify(body);
  const res = await fetch(`${BASE}${url}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Login failed: ' + JSON.stringify(d));
  TOKEN = d.token;
  console.log('✅ Login OK, role:', d.role);
}

async function submitPopulated() {
  const fd = new FormData();
  fd.append('title', 'Mr');
  fd.append('surname', 'TestUser');
  fd.append('forename', 'Phase');
  fd.append('dob', '1995-03-15');
  fd.append('mobile', '+44 7700 900001');
  fd.append('email', `phasea-${Date.now()}@test.com`);
  fd.append('addr1', '1 Test Street');
  fd.append('town', 'London');
  fd.append('postcode', 'E1 1AA');
  fd.append('country', 'United Kingdom');
  fd.append('birthPlace', 'Delhi');
  fd.append('nationality', 'Indian');
  fd.append('ni', 'AA 11 22 33 B');
  fd.append('rtw', 'Yes');
  fd.append('rate', '15.00');
  fd.append('prefLocations', JSON.stringify(['Camden Site']));
  // New Phase A fields
  fd.append('howHeard', 'Social Media');
  fd.append('passportCountry', 'India');
  fd.append('passportNumber', 'P1234567');
  fd.append('passportExpiry', '2028-06-15');
  fd.append('visaNumber', 'V987654');
  fd.append('visaExpiry', '2027-12-31');
  fd.append('siaBadgeNumber', 'SIA-999888');
  fd.append('siaBadgeExpiry', '2027-03-20');
  // JSON fields
  fd.append('prevAddresses', '[]');
  fd.append('employers', '[]');
  fd.append('referees', '[]');
  fd.append('skills', '[]');

  const { status, data } = await api('POST', '/api/applications', fd, true);
  console.log(`\n--- Submit populated application ---`);
  console.log('Status:', status);
  if (status !== 200 && status !== 201) {
    console.log('FAIL:', JSON.stringify(data));
    return false;
  }
  testAppId = data.id || data.applicationId || data.app_id;
  console.log('App ID:', testAppId);
  console.log('✅ Populated application submitted');
  return true;
}

async function verifyAppDetail() {
  console.log(`\n--- Verify application detail ---`);
  const { status, data } = await api('GET', `/api/applications`);
  if (status !== 200) { console.log('FAIL: list status', status); return false; }
  const app = Array.isArray(data) ? data.find(a => a.id === testAppId) : null;
  if (!app) { console.log('FAIL: app not found in list'); return false; }
  const checks = [
    ['howHeard', 'Social Media'],
    ['passportCountry', 'India'],
    ['passportNumber', 'P1234567'],
    ['visaNumber', 'V987654'],
    ['siaBadgeNumber', 'SIA-999888'],
  ];
  let allOk = true;
  for (const [key, expected] of checks) {
    const val = app[key];
    const ok = val === expected;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${key}: "${val}" (expected "${expected}")`);
  }
  // Date fields - check non-empty
  for (const key of ['passportExpiry', 'visaExpiry', 'siaBadgeExpiry']) {
    const val = app[key];
    const ok = val && String(val).length > 0;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${key}: "${val}"`);
  }
  return allOk;
}

async function testCompliance() {
  console.log(`\n--- Test compliance checklist ---`);
  const compliance = {
    electronicId: true,
    addressHistory: true,
    financialChecks: false,
    rightToWork: true,
    employmentHistory5y: false,
    gapPeriods: false,
    academicQualifications: false,
    criminalRecords: true,
    criminalRecordsLevel: 'Enhanced'
  };
  const { status, data } = await api('PUT', `/api/applications/${testAppId}/compliance`, compliance);
  console.log('Save compliance status:', status);
  if (status !== 200) { console.log('FAIL:', JSON.stringify(data)); return false; }

  // Reload and verify
  const { data: apps } = await api('GET', '/api/applications');
  const app = apps.find(a => a.id === testAppId);
  const c = app?.compliance;
  if (!c) { console.log('❌ No compliance data returned'); return false; }
  const parsed = typeof c === 'string' ? JSON.parse(c) : c;
  const ok = parsed.electronicId === true && parsed.criminalRecordsLevel === 'Enhanced' && parsed.rightToWork === true;
  console.log(`${ok ? '✅' : '❌'} Compliance persisted:`, JSON.stringify(parsed));
  return ok;
}

async function approveAndSetup() {
  console.log(`\n--- Approve application ---`);
  const { status, data } = await api('POST', `/api/applications/${testAppId}/approve`, { rate: 15 });
  console.log('Approve status:', status);
  if (status !== 200) { console.log('FAIL:', JSON.stringify(data)); return false; }
  console.log('✅ Application approved');

  // Get setup token from DB
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const [rows] = await pool.query('SELECT approval_token FROM registration_applications WHERE id = ?', [testAppId]);
  await pool.end();
  const setupToken = rows[0]?.approval_token;
  if (!setupToken) { console.log('❌ No setup token found'); return false; }

  // Complete setup-password
  const { status: s2, data: d2 } = await api('POST', '/api/auth/setup-password', {
    token: setupToken, password: 'Test@12345'
  });
  console.log('Setup password status:', s2);
  if (s2 !== 200) { console.log('FAIL:', JSON.stringify(d2)); return false; }
  testWorkerId = d2.workerId || d2.worker_id;
  console.log('Worker ID:', testWorkerId);
  console.log('✅ Password setup complete');
  return true;
}

async function verifyWorker() {
  console.log(`\n--- Verify worker carries fields ---`);
  const { status, data } = await api('GET', '/api/workers');
  if (status !== 200) { console.log('FAIL: workers status', status); return false; }
  const worker = data.find(w => w.id === testWorkerId || w.id === `WKR-${testWorkerId}`);
  if (!worker) { console.log('FAIL: worker not found. Looking for:', testWorkerId); return false; }
  const checks = [
    ['passportCountry', 'India'],
    ['passportNumber', 'P1234567'],
    ['visaNumber', 'V987654'],
    ['siaBadgeNumber', 'SIA-999888'],
  ];
  let allOk = true;
  for (const [key, expected] of checks) {
    const val = worker[key];
    const ok = val === expected;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} worker.${key}: "${val}" (expected "${expected}")`);
  }
  for (const key of ['passportExpiry', 'visaExpiry', 'siaBadgeExpiry']) {
    const val = worker[key];
    const ok = val && String(val).length > 0;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} worker.${key}: "${val}"`);
  }
  return allOk;
}

async function testBlankFlow() {
  console.log(`\n--- Test blank/UK-citizen flow ---`);
  const fd = new FormData();
  fd.append('title', 'Ms');
  fd.append('surname', 'Citizen');
  fd.append('forename', 'UK');
  fd.append('dob', '1998-07-20');
  fd.append('mobile', '+44 7700 900002');
  fd.append('email', `ukcitizen-${Date.now()}@test.com`);
  fd.append('addr1', '5 Blank Street');
  fd.append('town', 'London');
  fd.append('postcode', 'E2 2BB');
  fd.append('country', 'United Kingdom');
  fd.append('birthPlace', 'London');
  fd.append('nationality', 'British');
  fd.append('ni', 'BB 22 33 44 C');
  fd.append('rtw', 'Yes');
  fd.append('rate', '12.00');
  fd.append('prefLocations', JSON.stringify(['Hackney Depot']));
  // Deliberately omit all new fields (blank/UK citizen)
  fd.append('prevAddresses', '[]');
  fd.append('employers', '[]');
  fd.append('referees', '[]');
  fd.append('skills', '[]');

  const { status, data } = await api('POST', '/api/applications', fd, true);
  console.log('Blank submission status:', status);
  if (status === 200 || status === 201) {
    console.log('✅ Blank/UK-citizen application submitted OK');
    return true;
  }
  console.log('FAIL:', JSON.stringify(data));
  return false;
}

async function smokeTests() {
  console.log(`\n--- Smoke tests ---`);
  const endpoints = [
    ['/api/workers', 'Workers'],
    ['/api/applications', 'Applications'],
    ['/api/attendance', 'Attendance'],
    ['/api/payroll', 'Payroll'],
    ['/api/locations', 'Locations'],
    ['/api/settings', 'Settings'],
    ['/api/notifications', 'Notifications'],
  ];
  for (const [url, label] of endpoints) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? '✅' : '❌'} ${label}: HTTP ${status}`);
  }
}

async function main() {
  try {
    await login();
    const ok1 = await submitPopulated();
    if (!ok1) { console.log('\n❌ FAILED at populated submission'); process.exit(1); }
    const ok2 = await verifyAppDetail();
    const ok3 = await testCompliance();
    const ok4 = await approveAndSetup();
    if (!ok4) { console.log('\n❌ FAILED at approve/setup'); process.exit(1); }
    const ok5 = await verifyWorker();
    const ok6 = await testBlankFlow();
    await smokeTests();

    console.log(`\n===== RESULTS =====`);
    console.log(`Populated submission: ${ok1 ? '✅' : '❌'}`);
    console.log(`App detail fields:    ${ok2 ? '✅' : '❌'}`);
    console.log(`Compliance persist:   ${ok3 ? '✅' : '❌'}`);
    console.log(`Approve+Setup:        ${ok4 ? '✅' : '❌'}`);
    console.log(`Worker carry-over:    ${ok5 ? '✅' : '❌'}`);
    console.log(`Blank/UK flow:        ${ok6 ? '✅' : '❌'}`);
    const allPass = ok1 && ok2 && ok3 && ok4 && ok5 && ok6;
    console.log(`\n${allPass ? '✅ ALL PHASE A TESTS PASSED' : '⚠️ Some tests failed'}`);
    process.exit(allPass ? 0 : 1);
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }
}

main();
