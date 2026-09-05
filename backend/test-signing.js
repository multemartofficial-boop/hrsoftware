// Phase G Part 2 test: signing flow, audit trail, decline, access control
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
  const wid = 'WKR-2026-0154';

  // Clean slate
  await pool.query("DELETE FROM signature_requests WHERE worker_id = ?", [wid]);
  await pool.query("DELETE FROM notifications WHERE id LIKE 'SGN-%'");

  // Create a template + send it
  const tpl = await api('POST', '/api/documents/template', {
    name: 'Signing Test Doc',
    content: 'Dear {{worker_name}} ({{worker_code}}), please sign to confirm {{location_name}} at {{hourly_rate}}.'
  });
  const tplId = tpl.data.id;
  const send = await api('POST', `/api/documents/${tplId}/send`, { workerId: wid });
  const reqId = send.data.id;
  console.log(`Request created: ${reqId} status=${send.data.status}\n`);

  // ===== 1. Worker sees it in "mine" =====
  console.log('=== 1. WORKER LISTS OWN REQUESTS ===');
  const mine = await api('GET', '/api/documents/requests/mine', undefined, wToken);
  const m1 = mine.data.find(r => r.id === reqId);
  console.log(`Requests for worker: ${mine.data.length}, target pending=${m1?.status === 'pending'}`);
  if (m1?.status === 'pending') console.log('OK: pending request visible to worker');
  else { ok = false; console.log('FAIL'); }

  // ===== 2. View → viewed_at + audit 'viewed' =====
  console.log('\n=== 2. VIEW MARKS AUDIT ===');
  const v = await api('POST', `/api/documents/requests/${reqId}/view`, {}, wToken);
  const [afterView] = await pool.query('SELECT viewed_at, audit_log FROM signature_requests WHERE id = ?', [reqId]);
  const auditArr = typeof afterView[0]?.audit_log === 'string'
    ? JSON.parse(afterView[0].audit_log)
    : afterView[0]?.audit_log;
  console.log(`viewed_at=${afterView[0]?.viewed_at}, audit events=${JSON.stringify(auditArr)}`);
  const hasViewed = Array.isArray(auditArr) && auditArr.some(e => e.event === 'viewed');
  if (afterView[0]?.viewed_at && hasViewed) {
    console.log('OK: viewed timestamp + audit entry');
  } else { ok = false; console.log('FAIL: view not recorded'); }

  // ===== 3. Sign with typed signature =====
  console.log('\n=== 3. SIGN (type) ===');
  const sign = await api('POST', `/api/documents/requests/${reqId}/sign`, {
    signatureType: 'type', signatureData: 'Test Subbie'
  }, wToken);
  console.log(`Sign: ${sign.status} status=${sign.data?.status}`);
  const [signed] = await pool.query('SELECT status, signed_at, signer_ip, signature_type, signature_data, signed_content, audit_log FROM signature_requests WHERE id = ?', [reqId]);
  const s0 = signed[0] || {};
  console.log(`status=${s0.status}, signed_at=${s0.signed_at}, ip=${s0.signer_ip}, type=${s0.signature_type}`);
  console.log(`signed_content tail: "${(s0.signed_content || '').slice(-140)}"`);
  if (s0.status === 'signed' && s0.signed_at && s0.signature_type === 'type' && /Signed by WKR-2026-0154/.test(s0.signed_content || '')) {
    console.log('OK: signed with timestamp + signed_content preserved');
  } else { ok = false; console.log('FAIL: sign not persisted correctly'); }

  const [signNotif] = await pool.query('SELECT message, urgency FROM notifications WHERE id = ?', [`SGN-${reqId}`]);
  console.log(`Admin notification: "${signNotif[0]?.message}" (${signNotif[0]?.urgency})`);
  if (signNotif[0] && /signed.*Signing Test Doc/.test(signNotif[0].message)) console.log('OK: sign notification');
  else { ok = false; console.log('FAIL: no sign notification'); }

  // Double-sign should fail
  const reSign = await api('POST', `/api/documents/requests/${reqId}/sign`, { signatureType: 'type', signatureData: 'x' }, wToken);
  console.log(`Re-sign: ${reSign.status} — "${reSign.data?.error}"`);
  if (reSign.status === 400) console.log('OK: already-signed rejected'); else { ok = false; console.log('FAIL'); }

  // ===== 4. Draw + upload signature types (fresh requests) =====
  for (const type of ['draw', 'upload']) {
    const s2 = await api('POST', `/api/documents/${tplId}/send`, { workerId: wid });
    const fake = type === 'draw'
      ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const r = await api('POST', `/api/documents/requests/${s2.data.id}/sign`, { signatureType: type, signatureData: fake }, wToken);
    const [row] = await pool.query('SELECT status, signature_type, signature_data FROM signature_requests WHERE id = ?', [s2.data.id]);
    console.log(`${type}: sign=${r.status} status=${row[0]?.status} data=${String(row[0]?.signature_data).slice(0, 40)}...`);
    if (row[0]?.status === 'signed' && row[0]?.signature_type === type) console.log(`OK: ${type} signature stored`);
    else { ok = false; console.log(`FAIL: ${type}`); }
  }

  // ===== 5. Decline =====
  console.log('\n=== 5. DECLINE ===');
  const s3 = await api('POST', `/api/documents/${tplId}/send`, { workerId: wid });
  const dec = await api('POST', `/api/documents/requests/${s3.data.id}/decline`, {}, wToken);
  const [decRow] = await pool.query('SELECT status, declined_at FROM signature_requests WHERE id = ?', [s3.data.id]);
  const [decNotif] = await pool.query('SELECT message, urgency FROM notifications WHERE id = ?', [`SGN-${s3.data.id}`]);
  console.log(`Decline: ${dec.status} status=${decRow[0]?.status} declined_at=${decRow[0]?.declined_at}`);
  console.log(`Notification: "${decNotif[0]?.message}" (${decNotif[0]?.urgency})`);
  if (decRow[0]?.status === 'declined' && /declined to sign/.test(decNotif[0]?.message || '')) {
    console.log('OK: declined + admin notified');
  } else { ok = false; console.log('FAIL: decline flow'); }

  // ===== 6. Access control: worker can't touch another worker's request =====
  console.log('\n=== 6. ACCESS CONTROL ===');
  // find another worker
  const [others] = await pool.query("SELECT id FROM workers WHERE id != ? AND status = 'active' LIMIT 1", [wid]);
  const otherId = others[0]?.id;
  if (otherId) {
    const s4 = await api('POST', `/api/documents/${tplId}/send`, { workerId: otherId });
    const cross = await api('POST', `/api/documents/requests/${s4.data.id}/sign`, { signatureType: 'type', signatureData: 'hacker' }, wToken);
    const crossView = await api('GET', `/api/documents/requests/${s4.data.id}`, undefined, wToken);
    console.log(`Sign other's request: ${cross.status} — "${cross.data?.error}"`);
    console.log(`View other's request: ${crossView.status} — "${crossView.data?.error}"`);
    if (cross.status === 404 && crossView.status === 403) console.log('OK: cross-worker access blocked');
    else { ok = false; console.log('FAIL: access control'); }
    await pool.query('DELETE FROM signature_requests WHERE id = ?', [s4.data.id]);
  } else {
    console.log('SKIP: no second worker found');
  }
  // Admin list endpoint blocked for workers
  const adminList = await api('GET', '/api/documents/requests', undefined, wToken);
  console.log(`Worker hits admin list: ${adminList.status}`);
  if (adminList.status !== 200) console.log('OK: admin list blocked for workers'); else { ok = false; console.log('FAIL'); }

  // cleanup
  await pool.query('DELETE FROM signature_requests WHERE worker_id = ?', [wid]);
  await pool.query('DELETE FROM documents WHERE id = ?', [tplId]);
  await pool.query("DELETE FROM notifications WHERE id LIKE 'SGN-%'");

  // ===== 7. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/workers/WKR-2026-0154/compliance','Compliance'],
    ['/api/notifications','Notifications'],['/api/settings/bank-holidays','Bank Holidays'],
    ['/api/applications','Applications'],['/api/attendance/active/shifts','Live Map'],
    ['/api/assignments/today','Assignments'],['/api/documents','Documents'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  await pool.end();
  console.log(`\n${ok ? '✅ ALL PART 2 TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
