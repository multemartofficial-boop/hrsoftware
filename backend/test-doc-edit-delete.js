// Test: document edit + delete with linked-request protection
const mysql = require('mysql2/promise');
const fs = require('fs');
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
  const wid = 'WKR-2026-0154';

  // ===== 1. Create template, send it, then EDIT it =====
  console.log('=== 1. EDIT TEMPLATE — SENT REQUESTS UNCHANGED ===');
  const tpl = await api('POST', '/api/documents/template', {
    name: 'Edit Test Template',
    content: 'ORIGINAL content for {{worker_name}} ({{worker_code}}).'
  });
  const tplId = tpl.data.id;

  const send = await api('POST', `/api/documents/${tplId}/send`, { workerId: wid });
  const reqId = send.data.id;
  const [origReq] = await pool.query('SELECT rendered_content FROM signature_requests WHERE id = ?', [reqId]);
  const originalContent = origReq[0].rendered_content;
  console.log(`Sent request rendered: "${originalContent}"`);

  // Edit the template
  const edit = await api('PUT', `/api/documents/${tplId}`, {
    name: 'Edit Test Template v2',
    content: 'UPDATED content for {{worker_name}} at {{location_name}}.'
  });
  console.log(`Edit: ${edit.status} — ${edit.data?.message}`);
  if (edit.status === 200) console.log('OK: template updated');
  else { ok = false; console.log('FAIL: edit'); }

  // Audit integrity: the previously sent request must keep original content
  const [afterReq] = await pool.query('SELECT rendered_content FROM signature_requests WHERE id = ?', [reqId]);
  if (afterReq[0].rendered_content === originalContent) {
    console.log('OK: previously sent request content UNCHANGED (audit integrity)');
  } else { ok = false; console.log('FAIL: sent request content changed!'); }

  // Preview shows NEW content for future sends
  const prev = await api('GET', `/api/documents/${tplId}/preview/${wid}`);
  console.log(`Preview after edit: "${prev.data?.rendered}"`);
  if (/UPDATED content/.test(prev.data?.rendered || '') && !/ORIGINAL/.test(prev.data?.rendered || '')) {
    console.log('OK: future sends use updated content');
  } else { ok = false; console.log('FAIL: preview stale'); }

  // ===== 2. Delete BLOCKED by linked request =====
  console.log('\n=== 2. DELETE BLOCKED (linked request) ===');
  const del = await api('DELETE', `/api/documents/${tplId}`);
  console.log(`Delete: ${del.status} — "${del.data?.error}"`);
  if (del.status === 409 && /signature request/.test(del.data?.error || '')) {
    console.log('OK: deletion blocked with clear message');
  } else { ok = false; console.log('FAIL: expected 409'); }

  // Linked request still viewable
  const viewReq = await api('GET', `/api/documents/requests/${reqId}`);
  console.log(`Linked request still loads: ${viewReq.status}, doc="${viewReq.data?.document_name}", content intact=${viewReq.data?.rendered_content === originalContent}`);
  if (viewReq.status !== 200 || viewReq.data?.rendered_content !== originalContent) {
    ok = false; console.log('FAIL: linked request broken');
  } else console.log('OK: linked request fully viewable');

  // ===== 3. Delete unlinked document → works =====
  console.log('\n=== 3. DELETE UNLINKED TEMPLATE ===');
  const tpl2 = await api('POST', '/api/documents/template', { name: 'Delete Me', content: 'temp' });
  const del2 = await api('DELETE', `/api/documents/${tpl2.data.id}`);
  console.log(`Delete unlinked: ${del2.status} — ${del2.data?.message}`);
  const [gone] = await pool.query('SELECT id FROM documents WHERE id = ?', [tpl2.data.id]);
  if (del2.status === 200 && gone.length === 0) console.log('OK: unlinked template deleted');
  else { ok = false; console.log('FAIL'); }

  // ===== 4. PDF delete removes file from disk =====
  console.log('\n=== 4. DELETE UNLINKED PDF (file removed) ===');
  fs.writeFileSync('t.pdf', '%PDF-1.4 test');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync('t.pdf')], { type: 'application/pdf' }), 't.pdf');
  fd.append('name', 'Delete Me PDF');
  const up = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd });
  const upData = await up.json();
  const pdfPath = upData.filePath;
  const del3 = await api('DELETE', `/api/documents/${upData.id}`);
  const fileGone = !fs.existsSync(pdfPath);
  console.log(`Delete PDF: ${del3.status}, file removed: ${fileGone}`);
  if (del3.status === 200 && fileGone) console.log('OK: PDF + file deleted');
  else { ok = false; console.log('FAIL'); }
  fs.unlinkSync('t.pdf');

  // ===== 5. Rename a PDF (edit) =====
  fs.writeFileSync('r.pdf', '%PDF-1.4 test');
  const fd2 = new FormData();
  fd2.append('file', new Blob([fs.readFileSync('r.pdf')], { type: 'application/pdf' }), 'r.pdf');
  fd2.append('name', 'Rename Me');
  const up2 = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd2 });
  const up2Data = await up2.json();
  const ren = await api('PUT', `/api/documents/${up2Data.id}`, { name: 'Renamed PDF' });
  const [renRow] = await pool.query('SELECT name FROM documents WHERE id = ?', [up2Data.id]);
  console.log(`Rename PDF: ${ren.status}, name now "${renRow[0]?.name}"`);
  if (ren.status === 200 && renRow[0]?.name === 'Renamed PDF') console.log('OK: PDF renamed');
  else { ok = false; console.log('FAIL'); }
  // cleanup
  await api('DELETE', `/api/documents/${up2Data.id}`);
  fs.unlinkSync('r.pdf');
  await pool.query('DELETE FROM signature_requests WHERE id = ?', [reqId]);
  await pool.query('DELETE FROM documents WHERE id = ?', [tplId]);

  // ===== 6. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/documents','Documents'],['/api/workers','Workers'],['/api/attendance','Attendance'],
    ['/api/payroll','Payroll'],['/api/notifications','Notifications'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  await pool.end();
  console.log(`\n${ok ? '✅ ALL EDIT/DELETE TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
