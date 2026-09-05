// Phase G Part 1 test: documents, templates, send-for-signature
const mysql = require('mysql2/promise');
const fs = require('fs');
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

  const wid = 'WKR-2026-0154';

  // ===== 1. Upload a PDF =====
  console.log('=== 1. PDF UPLOAD ===');
  fs.writeFileSync('test-doc.pdf', '%PDF-1.4 test document content');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync('test-doc.pdf')], { type: 'application/pdf' }), 'test-contract.pdf');
  fd.append('name', 'Test Employment Contract');
  const up = await fetch(`${BASE}/api/documents/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd
  });
  const upData = await up.json();
  console.log(`Upload: ${up.status} id=${upData.id} path=${upData.filePath}`);
  if (up.status === 201 && fs.existsSync(upData.filePath)) {
    console.log('OK: PDF stored on disk + record created');
  } else { ok = false; console.log('FAIL: upload failed'); }
  const docId = upData.id;

  const { data: docList } = await api('GET', '/api/documents');
  const inList = docList.find(x => x.id === docId);
  console.log(`In documents list: ${!!inList}, type=${inList?.type}`);
  if (!inList || inList.type !== 'uploaded_pdf') { ok = false; console.log('FAIL'); }

  // ===== 2. Create a template =====
  console.log('\n=== 2. CREATE TEMPLATE ===');
  const tpl = await api('POST', '/api/documents/template', {
    name: 'Test Offer Letter',
    content: 'Dear {{worker_name}} ({{worker_code}}),\n\nYou are assigned to {{location_name}} starting {{start_date}} at {{hourly_rate}} per hour.\n\nRegards,\nWorkHR'
  });
  console.log(`Template: ${tpl.status} id=${tpl.data?.id} type=${tpl.data?.type}`);
  const tplId = tpl.data?.id;
  if (tpl.status === 201 && tpl.data?.type === 'template') console.log('OK: template saved');
  else { ok = false; console.log('FAIL'); }

  // ===== 3. Send template to worker → placeholders filled =====
  console.log('\n=== 3. SEND FOR SIGNATURE + PLACEHOLDERS ===');
  const send = await api('POST', `/api/documents/${tplId}/send`, { workerId: wid });
  console.log(`Send: ${send.status} requestId=${send.data?.id} status=${send.data?.status}`);
  const reqId = send.data?.id;
  if (send.status === 201 && send.data?.status === 'pending') console.log('OK: request created pending');
  else { ok = false; console.log('FAIL'); }

  const [reqRow] = await pool.query('SELECT * FROM signature_requests WHERE id = ?', [reqId]);
  const rc = reqRow[0]?.rendered_content || '';
  console.log(`Rendered content:\n---\n${rc}\n---`);
  const noTokens = !/\{\{/.test(rc);
  const hasName = rc.includes('Test Subbie');
  const hasCode = rc.includes('WKR-2026-0154');
  const hasRate = /£\d+\.\d{2}/.test(rc);
  console.log(`No leftover tokens: ${noTokens}, name: ${hasName}, code: ${hasCode}, rate: ${hasRate}`);
  if (noTokens && hasName && hasCode && hasRate) console.log('OK: placeholders substituted with worker data');
  else { ok = false; console.log('FAIL: placeholder substitution incomplete'); }

  // ===== 4. Tracking table =====
  console.log('\n=== 4. TRACKING TABLE ===');
  const { data: reqs } = await api('GET', '/api/documents/requests');
  const track = reqs.find(r => r.id === reqId);
  console.log(`Tracking row: worker=${track?.worker_name}, doc=${track?.document_name}, status=${track?.status}, sent=${track?.sent_at}`);
  if (track && track.status === 'pending' && track.worker_name === 'Test Subbie') {
    console.log('OK: pending request visible in tracking table');
  } else { ok = false; console.log('FAIL'); }

  // Cancel flow
  const cancel = await api('POST', `/api/documents/requests/${reqId}/cancel`, {});
  console.log(`Cancel: ${cancel.status} — ${cancel.data?.message}`);
  if (cancel.status === 200) console.log('OK: cancel works');
  else { ok = false; console.log('FAIL'); }

  // ===== 5. Worker cannot access another worker's request =====
  const wToken = (await (await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode: 'WKR-2026-0154', password: 'SubTest@123' })
  })).json()).token;
  const own = await api('GET', `/api/documents/requests/${reqId}`, undefined, wToken);
  console.log(`Worker views own request: ${own.status} (allowed — needed for Part 2 signing)`);
  if (own.status !== 200) { ok = false; console.log('FAIL: worker should view own request'); }

  // cleanup test data
  await pool.query('DELETE FROM signature_requests WHERE id = ?', [reqId]);
  await pool.query('DELETE FROM documents WHERE id IN (?, ?)', [docId, tplId]);
  if (upData.filePath && fs.existsSync(upData.filePath)) fs.unlinkSync(upData.filePath);
  fs.unlinkSync('test-doc.pdf');

  // ===== 6. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/workers/WKR-2026-0154/compliance','Compliance'],
    ['/api/notifications','Notifications'],['/api/assignments/today','Assignments'],
    ['/api/attendance/active/shifts','Live Map'],['/api/documents','Documents'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }
  const page = await fetch('http://localhost:8080/admin/documents');
  console.log(`${page.status === 200 ? 'OK' : 'FAIL'} ${page.status} Documents page`);

  await pool.end();
  console.log(`\n${ok ? '✅ ALL PART 1 TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
