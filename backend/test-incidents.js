// Phase 2 test: Incident reporting
// Worker reports an incident (with attachment) -> admin triages it
// (status/severity/internal note) -> verifies notification + action log.
require('dotenv').config();
const BASE = 'http://localhost:3001';
let ADMIN = '';

async function api(method, url, body, isForm, token = ADMIN) {
  const headers = { Authorization: `Bearer ${token}` };
  if (!isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${url}`, {
    method, headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
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
  if (!d.token) throw new Error('Worker login failed: ' + JSON.stringify(d));
  return d.token;
}

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

const stamp = Date.now();
const W1 = { name: 'Incident Tester One', email: `inc1-${stamp}@test.com` };
const W2 = { name: 'Incident Tester Two', email: `inc2-${stamp}@test.com` };
let w1id, w2id, incId, locId;

async function makeWorker(w) {
  const { status, data } = await api('POST', '/api/workers', {
    name: w.name, phone: '07000000000', email: w.email,
    location: 'Camden Site', role: 'Security Officer', rate: 14, address: 'x', nid: 'x'
  });
  if (status !== 201) throw new Error('create worker failed: ' + JSON.stringify(data));
  await api('POST', `/api/workers/${data.id}/reset-password`, { password: 'Test@1234' });
  return data.id;
}

async function main() {
  ADMIN = await login('ashraf.milon@gmail.com', 'Milon@1234');
  console.log('Admin login OK\n');

  /* ---- setup: two workers (w2 only used to verify access isolation) ---- */
  w1id = await makeWorker(W1);
  w2id = await makeWorker(W2);
  const w1 = await workerLogin(w1id, 'Test@1234');
  const w2 = await workerLogin(w2id, 'Test@1234');
  console.log('Worker logins OK\n');

  /* ---- 1. Worker reports an incident with attachment ---- */
  console.log('=== WORKER REPORTS INCIDENT ===');
  // locations table may be empty in this dev DB — create one to exercise the dropdown
  const { data: newLoc } = await api('POST', '/api/locations', { name: `Incident Test Site ${stamp}`, address: 'Test' });
  const { data: locs } = await api('GET', '/api/locations', null, false, w1);
  const loc = locs?.find(l => l.id === newLoc?.id) || locs?.[0];
  locId = loc?.id;
  check(!!loc, `Locations loaded for dropdown (${locs?.length})`);

  const fd = new FormData();
  fd.append('category', 'Safety Hazard');
  fd.append('locationId', loc.id);
  fd.append('description', 'Loose wiring near the main gate — trip and shock risk.');
  fd.append('attachments', new Blob(['%PDF-1.4 fake test pdf'], { type: 'application/pdf' }), 'hazard-photo.pdf');

  const { status: s1, data: d1 } = await api('POST', '/api/incidents', fd, true, w1);
  check(s1 === 201, `Submit incident (${s1})`, JSON.stringify(d1));
  incId = d1?.id;
  check(d1?.status === 'Open', 'Status starts Open');
  check(d1?.severity === 'Medium', 'Default severity Medium');
  check(d1?.locationName === loc.name, `Location resolved to "${loc.name}"`);
  check(d1?.attachments?.length === 1 && d1.attachments[0].name === 'hazard-photo.pdf', 'Attachment stored');
  check(d1?.internalNotes === undefined, 'Internal notes NOT exposed to worker');

  /* ---- 2. Worker sees own reports ---- */
  const { data: mine } = await api('GET', '/api/incidents/mine', null, false, w1);
  const myInc = mine?.find(i => i.id === incId);
  check(!!myInc, 'Incident appears in worker /mine list');
  check(myInc?.internalNotes === undefined, 'internalNotes stripped from worker view');

  /* ---- 3. Admin list + detail ---- */
  console.log('\n=== ADMIN TRIAGE ===');
  const { status: s2, data: all } = await api('GET', '/api/incidents');
  check(s2 === 200 && all.some(i => i.id === incId), `Admin list contains incident (${s2})`);

  const { data: det } = await api('GET', `/api/incidents/${incId}`);
  check(det?.reporterName === W1.name, `Reporter = ${W1.name}`);
  check(det?.reportedBy === w1id, `reported_by = ${w1id}`);

  /* ---- 4. Admin updates status + severity ---- */
  const { status: s3, data: d3 } = await api('PATCH', `/api/incidents/${incId}`, {
    status: 'Under Review', severity: 'High'
  });
  check(s3 === 200 && d3.status === 'Under Review' && d3.severity === 'High',
    `Status → Under Review, severity → High (${s3})`);

  const { status: sBad } = await api('PATCH', `/api/incidents/${incId}`, { status: 'Bogus' });
  check(sBad === 400, `Invalid status rejected (${sBad})`);

  /* ---- 5. Internal note ---- */
  const { status: s4, data: d4 } = await api('POST', `/api/incidents/${incId}/notes`, {
    note: 'Called site manager — electrician booked for tomorrow morning.'
  });
  const note = d4?.internalNotes?.[0];
  check(s4 === 200 && !!note, `Internal note added (${s4})`);
  check(note?.author === 'Milon' && !!note?.at, `Note has author "${note?.author}" + timestamp`);

  // Worker must still not see the internal note
  const { data: mine2 } = await api('GET', '/api/incidents/mine', null, false, w1);
  const myInc2 = mine2?.find(i => i.id === incId);
  check(myInc2?.status === 'Under Review', 'Worker sees updated status');
  check(myInc2?.internalNotes === undefined, 'Worker still cannot see internal notes');

  /* ---- 6. Secure attachment access ---- */
  console.log('\n=== ATTACHMENTS ===');
  const rOk = await fetch(`${BASE}/api/incidents/${incId}/attachment/0`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  check(rOk.status === 200 && (rOk.headers.get('content-type') || '').includes('pdf'),
    `Admin can view attachment (${rOk.status}, ${rOk.headers.get('content-type')})`);

  const rSelf = await fetch(`${BASE}/api/incidents/${incId}/attachment/0`, { headers: { Authorization: `Bearer ${w1}` } });
  check(rSelf.status === 200, `Reporting worker can view own attachment (${rSelf.status})`);

  const rOther = await fetch(`${BASE}/api/incidents/${incId}/attachment/0`, { headers: { Authorization: `Bearer ${w2}` } });
  check(rOther.status === 403, `Other worker denied (${rOther.status})`);

  const rAnon = await fetch(`${BASE}/api/incidents/${incId}/attachment/0`);
  check(rAnon.status === 401, `Unauthenticated denied (${rAnon.status})`);

  /* ---- 7. Admin notification fired ---- */
  console.log('\n=== NOTIFICATION + LOG ===');
  const { data: notices } = await api('GET', '/api/notifications');
  const n = notices?.find(x => String(x.id).includes(incId));
  check(!!n, 'Admin notification created for incident');
  if (n) check(n.urgency === 'warning', `Urgency = warning (Safety Hazard)`, n.urgency);

  const { data: logs } = await api('GET', `/api/action-logs?action=reported_incident`);
  const rl = logs?.find(l => l.targetId === incId);
  check(!!rl && rl.actorType === 'worker' && rl.actorId === w1id,
    `reported_incident logged (actor worker ${rl?.actorId})`);

  const { data: logs2 } = await api('GET', '/api/action-logs?action=updated_incident');
  check(logs2?.some(l => l.targetId === incId && l.details?.changes?.status?.to === 'Under Review'),
    'updated_incident logged with status change');

  const { data: logs3 } = await api('GET', '/api/action-logs?action=added_incident_note');
  check(logs3?.some(l => l.targetId === incId), 'added_incident_note logged');

  /* ---- 8. Filters ---- */
  const { data: fSev } = await api('GET', '/api/incidents?severity=High');
  check(fSev.some(i => i.id === incId) && fSev.every(i => i.severity === 'High'), 'severity filter works');
  const { data: fSt } = await api('GET', '/api/incidents?status=Under Review');
  check(fSt.some(i => i.id === incId), 'status filter works');
  const { data: fLoc } = await api('GET', `/api/incidents?locationId=${loc.id}`);
  check(fLoc.some(i => i.id === incId), 'location filter works');

  /* ---- cleanup ---- */
  console.log('\n=== CLEANUP ===');
  const pool = require('./config/database');
  const [inc] = await pool.query('SELECT attachments FROM incidents WHERE id = ?', [incId]);
  const atts = typeof inc[0]?.attachments === 'string' ? JSON.parse(inc[0].attachments) : inc[0]?.attachments || [];
  const fs = require('fs');
  const path = require('path');
  for (const a of atts) {
    const p = path.join(__dirname, 'uploads', String(a.url).replace('/uploads/', ''));
    try { fs.unlinkSync(p); console.log('  removed', a.url); } catch {}
  }
  await pool.query('DELETE FROM incidents WHERE id = ?', [incId]);
  await pool.query('DELETE FROM notifications WHERE id LIKE ?', [`N-INC-${incId}`]);
  if (locId) await pool.query('DELETE FROM locations WHERE id = ?', [locId]);
  for (const wid of [w1id, w2id]) {
    await pool.query('DELETE FROM users WHERE worker_id = ?', [wid]);
    await pool.query('DELETE FROM workers WHERE id = ?', [wid]);
  }
  console.log('Test incidents, notifications, location, workers removed.');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
