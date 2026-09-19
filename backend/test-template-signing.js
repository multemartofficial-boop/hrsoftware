// Template company-signature flow: sign-before-send, reuse, re-sign on edit.
// Usage: node test-template-signing.js  (server must be running on :3001)
require('dotenv').config();
const pool = require('./config/database');
const BASE = 'http://localhost:3001';
let ADMIN = '';

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

async function api(method, url, body, token = ADMIN) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const WID = 'WKR-2026-0148';
const WPASS = 'Part7Test@123';

async function main() {
  const login = await api('POST', '/api/auth/login', { email: 'ashraf.milon@gmail.com', password: 'Milon@1234' }, '');
  ADMIN = login.data.token;
  check(!!ADMIN, 'admin login');

  const wl = await api('POST', '/api/auth/worker/login', { workerCode: WID, password: WPASS }, '');
  const WTOKEN = wl.data.token;
  check(!!WTOKEN, 'worker login', JSON.stringify(wl.data).slice(0, 100));
  if (!ADMIN || !WTOKEN) { console.log('cannot continue'); process.exit(1); }

  // ---- unsigned template cannot be sent ----
  const tpl = await api('POST', '/api/documents/template', {
    name: 'Template-Sign Test',
    content: 'Dear {{worker_name}}, you agree to the terms.',
  });
  check(tpl.status === 201, 'template created', JSON.stringify(tpl.data).slice(0, 100));
  const docId = tpl.data.id;

  const sendUnsigned = await api('POST', `/api/documents/${docId}/send`, { workerId: WID });
  check(sendUnsigned.status === 400 && /sign/i.test(sendUnsigned.data.error || ''),
    'send blocked until template is signed', `HTTP ${sendUnsigned.status}`);

  // ---- admin signs the template ----
  const sign = await api('POST', `/api/documents/${docId}/sign-template`, {
    signatureType: 'type', signatureData: 'Ashraf Milon',
  });
  check(sign.status === 200, 'template signed', JSON.stringify(sign.data));
  const [t1] = await pool.query(
    'SELECT admin_signed_by, admin_signed_at, signed_content_hash FROM documents WHERE id = ?', [docId]);
  check(!!t1[0].admin_signed_by && t1[0].admin_signed_at && t1[0].signed_content_hash,
    'signature stored on template with content hash', `by=${t1[0].admin_signed_by}`);
  const signerName = t1[0].admin_signed_by;

  // ---- send now works; request carries the company signature snapshot ----
  const send1 = await api('POST', `/api/documents/${docId}/send`, { workerId: WID });
  check(send1.status === 201, 'send after signing', `HTTP ${send1.status}`);
  const reqId = send1.data.id;
  const [r0] = await pool.query('SELECT admin_signed_by, admin_signed_at, admin_signature_data FROM signature_requests WHERE id = ?', [reqId]);
  check(r0[0].admin_signed_by === signerName && r0[0].admin_signed_at && r0[0].admin_signature_data === 'Ashraf Milon',
    'request carries company signature snapshot');

  // ---- worker signs → completed immediately (both signatures) ----
  const wsign = await api('POST', `/api/documents/requests/${reqId}/sign`, {
    signatureType: 'type', signatureData: 'Test Worker',
  }, WTOKEN);
  check(wsign.status === 200 && wsign.data.status === 'signed', 'worker sign completes doc', JSON.stringify(wsign.data));
  const [r1] = await pool.query('SELECT status, signed_content FROM signature_requests WHERE id = ?', [reqId]);
  check(r1[0].status === 'signed', 'status signed');
  check(new RegExp(`Signed by Company: ${signerName} on \\d{4}-`).test(r1[0].signed_content), 'signed_content has labelled company block w/ timestamp');
  check(/Signed by Worker: .+ on \d{4}-/.test(r1[0].signed_content), 'signed_content has labelled worker block w/ timestamp');

  // ---- same signed template can be re-sent without re-signing ----
  const send2 = await api('POST', `/api/documents/${docId}/send`, { workerId: WID });
  check(send2.status === 201, 'template reusable — second send without re-sign');

  // ---- editing content invalidates the signature → send blocked again ----
  const edit = await api('PUT', `/api/documents/${docId}`, { name: 'Template-Sign Test v2', content: 'CHANGED content {{worker_name}}' });
  check(edit.status === 200, 'template edited');
  const [t2] = await pool.query('SELECT admin_signed_at, signed_content_hash FROM documents WHERE id = ?', [docId]);
  check(t2[0].admin_signed_at === null && t2[0].signed_content_hash === null, 'content change invalidates signature');
  const sendAfterEdit = await api('POST', `/api/documents/${docId}/send`, { workerId: WID });
  check(sendAfterEdit.status === 400, 'send blocked until re-signed', `HTTP ${sendAfterEdit.status}`);

  // ---- re-sign → send works again ----
  const reSign = await api('POST', `/api/documents/${docId}/sign-template`, {
    signatureType: 'type', signatureData: 'Ashraf Milon',
  });
  check(reSign.status === 200, 'template re-signed');
  const send3 = await api('POST', `/api/documents/${docId}/send`, { workerId: WID });
  check(send3.status === 201, 'send works after re-signing');

  // ---- rename only (no content change) keeps the signature ----
  await api('PUT', `/api/documents/${docId}`, { name: 'Renamed Template' });
  const [t3] = await pool.query('SELECT admin_signed_at FROM documents WHERE id = ?', [docId]);
  check(t3[0].admin_signed_at !== null, 'rename alone keeps signature valid');

  // ---- cleanup ----
  const reqIds = [reqId, send2.data?.id, send3.data?.id].filter(Boolean);
  await pool.query(`DELETE FROM signature_requests WHERE id IN (${reqIds.map(() => '?').join(',')})`, reqIds);
  await pool.query('DELETE FROM documents WHERE id = ?', [docId]);
  await pool.query("DELETE FROM notifications WHERE id LIKE 'SGN-%'");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
