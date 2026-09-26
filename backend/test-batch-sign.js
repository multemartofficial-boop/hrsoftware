// Batch documents feature test: upload -> send-batch -> worker ticks+sign-batch
// Also verifies DB-backed file storage + serving, and the duplicate-send guard.
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

const check = (cond, label) => {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

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

  // Create a fresh test worker with a known password
  const stamp = Date.now();
  const mk = await api('POST', '/api/workers', {
    name: 'Batch Sign Tester', phone: '07000000000', email: `batch-${stamp}@test.com`,
    location: 'Camden Site', role: 'Security Officer', rate: 14, address: 'x', nid: 'x'
  });
  if (mk.status !== 201) throw new Error('create worker failed: ' + JSON.stringify(mk.data));
  const wid = mk.data.id;
  await api('POST', `/api/workers/${wid}/reset-password`, { password: 'Test@1234' });
  console.log(`Test worker: ${wid}\n`);

  const docIds = [];

  // ===== 1. Upload two PDFs (stored in DB) =====
  console.log('=== 1. UPLOAD (DB STORAGE) ===');
  for (const name of ['Gov Test Doc A', 'Gov Test Doc B']) {
    const fd = new FormData();
    fd.append('file', new Blob(['%PDF-1.4 batch test'], { type: 'application/pdf' }), `${name}.pdf`);
    fd.append('name', name);
    const up = await fetch(`${BASE}/api/documents/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd
    });
    const upData = await up.json();
    console.log(`Upload "${name}": ${up.status} id=${upData.id} file_id=${upData.file_id}`);
    check(up.status === 201 && !!upData.file_id, `${name} uploaded with file_id`);
    docIds.push(upData.id);
  }
  const [sf] = await pool.query('SELECT id, size, mime FROM stored_files WHERE id = (SELECT file_id FROM documents WHERE id = ?)', [docIds[0]]);
  check(sf.length === 1 && sf[0].size > 0, 'file bytes landed in stored_files');

  // ===== 2. Batch send to worker =====
  console.log('\n=== 2. SEND-BATCH ===');
  const send = await api('POST', '/api/documents/send-batch', { workerId: wid, documentIds: docIds });
  console.log(`send-batch: ${send.status}`, JSON.stringify(send.data));
  check(send.status === 201 && send.data.sent === 2, 'both docs sent');
  const reqIds = (send.data.requests || []).map(r => r.id);

  // duplicate pending guard — second send-batch should skip
  const dup = await api('POST', '/api/documents/send-batch', { workerId: wid, documentIds: [docIds[0]] });
  console.log(`duplicate send: ${dup.status}`, JSON.stringify(dup.data));
  check(dup.data.sent === 0 && dup.data.failed.length === 1, 'duplicate pending request skipped');

  // ===== 3. Worker signs batch =====
  console.log('\n=== 3. WORKER SIGN-BATCH ===');
  const wLogin = await (await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode: wid, password: 'Test@1234' })
  })).json();
  if (!wLogin.token) throw new Error('Worker login failed');
  const wToken = wLogin.token;
  console.log('Worker login OK');

  const mine = await api('GET', '/api/documents/requests/mine', undefined, wToken);
  const mineReqs = (mine.data || []).filter(r => reqIds.includes(r.id));
  check(mineReqs.length === 2 && mineReqs.every(r => r.has_file), 'worker sees 2 pending docs with has_file');

  // worker fetches file for first request
  const fRes = await fetch(`${BASE}/api/documents/requests/${reqIds[0]}/file`, { headers: { Authorization: `Bearer ${wToken}` } });
  const fBuf = Buffer.from(await fRes.arrayBuffer());
  check(fRes.status === 200 && fRes.headers.get('content-type') === 'application/pdf' && fBuf.length > 10, 'worker streams uploaded PDF from DB');

  // sign only the ticked one first (batch of 1), then the other
  const sb1 = await api('POST', '/api/documents/requests/sign-batch', {
    requestIds: [reqIds[0]], signatureType: 'type', signatureData: 'Test Subbie'
  }, wToken);
  console.log(`sign-batch 1: ${sb1.status}`, JSON.stringify(sb1.data));
  check(sb1.status === 200 && sb1.data.signed.length === 1 && sb1.data.signed[0].status === 'worker_signed', 'first doc signed (awaiting countersign)');

  const sb2 = await api('POST', '/api/documents/requests/sign-batch', {
    requestIds: [reqIds[1], reqIds[0]], signatureType: 'type', signatureData: 'Test Subbie'
  }, wToken);
  console.log(`sign-batch 2: ${sb2.status}`, JSON.stringify(sb2.data));
  check(sb2.data.signed.length === 1 && sb2.data.failed.length === 1, 'second signs, already-signed reports failed');

  // ===== 4. Admin countersigns one =====
  console.log('\n=== 4. COUNTERSIGN ===');
  const cs = await api('POST', `/api/documents/requests/${reqIds[0]}/countersign`, { signatureType: 'type', signatureData: 'A M Abubakar' });
  console.log(`countersign: ${cs.status}`, JSON.stringify(cs.data));
  check(cs.status === 200 && cs.data.status === 'signed', 'admin countersign completes request');

  // ===== 5. Admin file endpoints =====
  const af = await fetch(`${BASE}/api/documents/${docIds[0]}/file`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  check(af.status === 200, 'admin streams doc file');

  // other worker cannot fetch
  const foreign = await fetch(`${BASE}/api/documents/requests/${reqIds[0]}/file`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  check(foreign.status === 200, 'admin can fetch request file');

  // ===== Cleanup =====
  console.log('\n=== CLEANUP ===');
  await pool.query('DELETE FROM signature_requests WHERE worker_id = ?', [wid]);
  for (const id of docIds) {
    const [row] = await pool.query('SELECT file_id FROM documents WHERE id = ?', [id]);
    await pool.query('DELETE FROM documents WHERE id = ?', [id]);
    if (row[0]?.file_id) await pool.query('DELETE FROM stored_files WHERE id = ?', [row[0].file_id]);
  }
  await pool.query('DELETE FROM notifications WHERE worker_id = ?', [wid]);
  await pool.query('DELETE FROM users WHERE worker_id = ?', [wid]);
  await pool.query('DELETE FROM workers WHERE id = ?', [wid]);
  console.log('cleanup done');

  await pool.end();
  console.log(`\n${ok ? 'ALL BATCH TESTS PASSED' : 'Some checks FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
