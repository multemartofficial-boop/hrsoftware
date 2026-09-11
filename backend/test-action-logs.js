// Phase 1 test: Action History log
// Exercises several logged actions, then verifies each appears in /api/action-logs
// with the correct actor, action, target and timestamp.
require('dotenv').config();
const BASE = 'http://localhost:3001';
let TOKEN = '';

async function api(method, url, body, isForm) {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  if (!isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${url}`, {
    method, headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Login failed: ' + JSON.stringify(d));
  TOKEN = d.token;
  console.log(`Login OK as ${d.user?.name} (${d.user?.role})\n`);
}

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

async function findLog(action, targetId, logs) {
  return logs.find(l => l.action === action && String(l.targetId) === String(targetId));
}

async function main() {
  await login();

  /* ---- 1. Submit + approve an application ---- */
  console.log('=== APPROVE APPLICATION ===');
  const fd = new FormData();
  const email = `actionlog-${Date.now()}@test.com`;
  fd.append('title', 'Mr'); fd.append('surname', 'Logtest'); fd.append('forename', 'Action');
  fd.append('dob', '1990-01-01'); fd.append('mobile', '+44 7700 900999');
  fd.append('email', email);
  fd.append('addr1', '1 Log Lane'); fd.append('town', 'London');
  fd.append('postcode', 'E1 1AA'); fd.append('country', 'United Kingdom');
  fd.append('birthPlace', 'London'); fd.append('nationality', 'British');
  fd.append('ni', 'AA 11 22 33 B'); fd.append('rtw', 'Yes');
  fd.append('appliedFor', 'Security Officer');
  fd.append('gdprConsent', 'Yes');
  fd.append('prevAddresses', '[]'); fd.append('employers', '[]');
  fd.append('referees', '[]'); fd.append('skills', '[]');

  const { status: s1, data: d1 } = await api('POST', '/api/applications', fd, true);
  check(s1 === 200 || s1 === 201, `Submit application (${s1})`, JSON.stringify(d1));
  const appId = d1?.id;

  const { status: s2, data: d2 } = await api('POST', `/api/applications/${appId}/approve`, { rate: 14 });
  check(s2 === 200, `Approve application (${s2})`, JSON.stringify(d2));
  const workerId = d2?.workerId;

  // Resend setup link (approved, not yet set up)
  const { status: s3 } = await api('POST', `/api/applications/${appId}/resend-setup`);
  check(s3 === 200, `Resend setup link (${s3})`);

  /* ---- 2. Attendance add / edit / delete ---- */
  console.log('\n=== ATTENDANCE ===');
  const { status: sW, data: dW } = await api('POST', '/api/workers', {
    name: 'Log Test Worker', phone: '07000000000', email,
    location: 'Test Site', role: 'Security Officer', rate: 14, address: '1 Log Lane', nid: 'TEST-NID'
  });
  check(sW === 201, `Create worker (${sW})`, JSON.stringify(dW));
  const w = { id: dW?.id, name: 'Log Test Worker', location: 'Test Site' };
  const { status: s4, data: d4 } = await api('POST', '/api/attendance', {
    workerId: w.id, date: '2026-09-10', in: '09:00', out: '17:00', location: w.location || 'Test Site'
  });
  check(s4 === 201, `Add attendance (${s4})`, JSON.stringify(d4));
  const attId = d4?.id;

  const { status: s5 } = await api('PUT', `/api/attendance/${attId}`, {
    workerId: w.id, date: '2026-09-10', in: '09:00', out: '18:30', location: w.location || 'Test Site'
  });
  check(s5 === 200, `Edit attendance (${s5})`);

  /* ---- 3. Change a setting ---- */
  console.log('\n=== SETTINGS ===');
  const { data: settings } = await api('GET', '/api/settings');
  const newMax = (settings.maxAdvance ?? 500) + 1;
  const { status: s6 } = await api('PUT', '/api/settings', { ...settings, maxAdvance: newMax });
  check(s6 === 200, `Update settings (${s6})`);

  /* ---- 4. Location add / delete ---- */
  console.log('\n=== LOCATION ===');
  const { status: s7, data: d7 } = await api('POST', '/api/locations', { name: 'Log Test Site', address: 'Nowhere' });
  check(s7 === 201, `Add location (${s7})`, JSON.stringify(d7));
  const locId = d7?.id;

  const { status: s8 } = await api('PUT', `/api/locations/${locId}`, { name: 'Log Test Site 2', address: 'Somewhere' });
  check(s8 === 200, `Edit location (${s8})`);

  /* ---- 5. Verify logs ---- */
  console.log('\n=== VERIFY ACTION LOGS ===');
  const { status: s9, data: logs } = await api('GET', '/api/action-logs');
  check(s9 === 200 && Array.isArray(logs), `GET /api/action-logs (${s9}) — ${logs?.length} entries`);

  const lApprove = await findLog('approved_application', appId, logs);
  check(!!lApprove, 'approved_application logged', `target=${appId}`);
  if (lApprove) {
    check(lApprove.actorType === 'admin' && !!lApprove.actorName, `  actor is admin "${lApprove.actorName}"`);
    check(lApprove.details?.workerId === workerId, `  details.workerId=${workerId}`, JSON.stringify(lApprove.details));
    check(!!lApprove.createdAt, `  has timestamp (${lApprove.createdAt})`);
  }

  const lResend = await findLog('resent_setup_link', appId, logs);
  check(!!lResend, 'resent_setup_link logged');

  const lAdd = await findLog('added_attendance', attId, logs);
  check(!!lAdd, 'added_attendance logged');

  const lEdit = await findLog('edited_attendance', attId, logs);
  check(!!lEdit, 'edited_attendance logged');
  if (lEdit) {
    check(!!lEdit.details?.before && !!lEdit.details?.after, '  has before/after values', JSON.stringify(lEdit.details));
  }

  const lSettings = logs.find(l => l.action === 'changed_settings' && l.details?.changes?.maxAdvance);
  check(!!lSettings, 'changed_settings logged with maxAdvance diff');
  if (lSettings) {
    const ch = lSettings.details.changes.maxAdvance;
    check(String(ch.from) === String(settings.maxAdvance) && String(ch.to) === String(newMax),
      `  diff ${settings.maxAdvance} → ${newMax}`, JSON.stringify(ch));
  }

  const lLocAdd = await findLog('added_location', locId, logs);
  check(!!lLocAdd, 'added_location logged');
  const lLocEdit = await findLog('edited_location', locId, logs);
  check(!!lLocEdit && lLocEdit.details?.after?.name === 'Log Test Site 2', 'edited_location logged with new name');

  const lWorker = await findLog('created_worker', w.id, logs);
  check(!!lWorker && lWorker.details?.name === 'Log Test Worker', 'created_worker logged');

  /* ---- 6. Filter tests ---- */
  console.log('\n=== FILTERS ===');
  const { data: filtered } = await api('GET', '/api/action-logs?action=edited_attendance');
  check(filtered.every(l => l.action === 'edited_attendance') && filtered.length >= 1,
    `action=edited_attendance filter (${filtered?.length} rows)`);

  const { data: byActor } = await api('GET', '/api/action-logs?actorType=admin');
  check(byActor.every(l => l.actorType === 'admin'), `actorType=admin filter (${byActor?.length} rows)`);

  const today = new Date().toISOString().slice(0, 10);
  const { data: byDate } = await api('GET', `/api/action-logs?from=${today}&to=${today}`);
  check(byDate.length >= 7 && byDate.every(l => String(l.createdAt).slice(0, 10) === today),
    `from/to date filter (${byDate?.length} rows today)`);

  const { data: byName } = await api('GET', '/api/action-logs?actor=milon');
  check(byName.length >= 1, `actor name search (${byName?.length} rows)`);

  const { data: actionList } = await api('GET', '/api/action-logs/actions');
  check(Array.isArray(actionList) && actionList.includes('approved_application'),
    `distinct actions endpoint (${actionList?.length} types)`);

  // Auth guard: no token → 401
  const res = await fetch(`${BASE}/api/action-logs`);
  check(res.status === 401, 'unauthenticated request rejected (401)');

  /* ---- 7. Cleanup ---- */
  console.log('\n=== CLEANUP ===');
  await api('DELETE', `/api/attendance/${attId}`);
  await api('DELETE', `/api/locations/${locId}`);
  const { data: dDel } = await api('DELETE', `/api/workers/${w.id}`);
  const pool = require('./config/database');
  await pool.query('DELETE FROM users WHERE email = ?', [email]);
  await pool.query('DELETE FROM password_reset_tokens WHERE email = ?', [email]);
  await pool.query('DELETE FROM registration_applications WHERE id = ?', [appId]);
  console.log('Test application, tokens, attendance, worker and location removed.');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
