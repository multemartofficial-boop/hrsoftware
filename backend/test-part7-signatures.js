// Part 7 focused tests: template-only signatures + dual signatures.
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

  // ---- worker login ----
  const wl = await api('POST', '/api/auth/worker/login', { workerCode: WID, password: WPASS }, '');
  const WTOKEN = wl.data.token;
  check(!!WTOKEN, 'worker login', JSON.stringify(wl.data).slice(0, 100));
  if (!WTOKEN) { console.log('\nCannot continue without a worker session'); process.exit(1); }

  // ---- template-only: upload endpoint gone ----
  const up = await api('POST', '/api/documents/upload', {});
  check(up.status === 404, 'PDF upload endpoint removed', String(up.status));

  // ---- legacy uploaded_pdf doc cannot be sent ----
  await pool.query("DELETE FROM signature_requests WHERE id IN ('SIG-LEGACY-TEST', 'SIG-LEGACY-PENDING', 'SIG-LEGACY-P2')");
  await pool.query("DELETE FROM documents WHERE id = 'DOC-LEGACY-TEST'");
  const [ins] = await pool.query(
    "INSERT INTO documents (id, name, type, file_path) VALUES ('DOC-LEGACY-TEST','Legacy PDF','uploaded_pdf','uploads/none.pdf')"
  );
  const sendLegacy = await api('POST', '/api/documents/DOC-LEGACY-TEST/send', { workerId: WID });
  check(sendLegacy.status === 400, 'sending a non-template doc rejected', String(sendLegacy.status));

  // ---- create template — must be company-signed before it can be sent ----
  const tpl = await api('POST', '/api/documents/template', {
    name: 'Part7 Dual-Sign Test',
    content: 'Dear {{worker_name}} ({{worker_code}}), this confirms your assignment.',
  });
  check(tpl.status === 201 && tpl.data.type === 'template', 'template created', JSON.stringify(tpl.data).slice(0, 100));
  const signTpl = await api('POST', `/api/documents/${tpl.data.id}/sign-template`, {
    signatureType: 'type', signatureData: 'Template Admin',
  });
  check(signTpl.status === 200, 'template company-signed', JSON.stringify(signTpl.data));
  const send = await api('POST', `/api/documents/${tpl.data.id}/send`, { workerId: WID });
  check(send.status === 201 && send.data.status === 'pending', 'request sent (pending)');
  const reqId = send.data.id;

  // ---- worker signs a company-signed request → fully signed immediately ----
  const sign = await api('POST', `/api/documents/requests/${reqId}/sign`, {
    signatureType: 'type', signatureData: 'Test Subbie',
  }, WTOKEN);
  check(sign.status === 200 && sign.data.status === 'signed', 'worker sign → signed (company pre-signed)', JSON.stringify(sign.data));
  const [r1] = await pool.query('SELECT status, admin_signed_at FROM signature_requests WHERE id = ?', [reqId]);
  check(r1[0].status === 'signed' && r1[0].admin_signed_at !== null, 'completed with company signature on file');

  // ---- legacy pending request (no company signature) still needs countersign ----
  await pool.query(
    `INSERT INTO signature_requests (id, document_id, worker_id, status, rendered_content)
     VALUES ('SIG-LEGACY-PENDING', ?, ?, 'pending', 'Legacy body for countersign')`,
    [tpl.data.id, WID]
  );
  const legSign = await api('POST', '/api/documents/requests/SIG-LEGACY-PENDING/sign', {
    signatureType: 'type', signatureData: 'Test Subbie',
  }, WTOKEN);
  check(legSign.status === 200 && legSign.data.status === 'worker_signed', 'legacy request: worker sign → worker_signed');
  const counter = await api('POST', '/api/documents/requests/SIG-LEGACY-PENDING/countersign', {
    signatureType: 'type', signatureData: 'Ashraf Milon',
  });
  check(counter.status === 200 && counter.data.status === 'signed', 'legacy request: countersign → signed');
  const [rL] = await pool.query(
    'SELECT status, admin_signed_by, admin_signature_type, admin_signature_data, signed_content FROM signature_requests WHERE id = ?',
    ['SIG-LEGACY-PENDING']
  );
  check(rL[0].status === 'signed' && rL[0].admin_signature_data === 'Ashraf Milon', 'legacy countersign stored admin signature');
  check(/Countersigned for the company by/.test(rL[0].signed_content), 'legacy signed_content has countersign block');

  // ---- double sign rejected ----
  const reSign = await api('POST', `/api/documents/requests/${reqId}/sign`, { signatureType: 'type', signatureData: 'x' }, WTOKEN);
  check(reSign.status === 400, 're-sign rejected');

  // ---- countersign rejected on a company-signed (complete) request ----
  const reCounter0 = await api('POST', `/api/documents/requests/${reqId}/countersign`, { signatureType: 'type', signatureData: 'x' });
  check(reCounter0.status === 400, 'countersign on already-signed request rejected');

  // ---- completed request carries both labelled signature blocks ----
  const [r2] = await pool.query('SELECT signed_content FROM signature_requests WHERE id = ?', [reqId]);
  check(/Signed by Company: .+ on \d{4}-/.test(r2[0].signed_content), 'signed_content has labelled company block');
  check(/Signed by Worker: .+ on \d{4}-/.test(r2[0].signed_content), 'signed_content has labelled worker block');

  // ---- audit log on the legacy countersigned request has both events ----
  const [r3] = await pool.query('SELECT audit_log FROM signature_requests WHERE id = ?', ['SIG-LEGACY-PENDING']);
  const audit = typeof r3[0].audit_log === 'string' ? JSON.parse(r3[0].audit_log) : r3[0].audit_log;
  check(audit.some(e => e.event === 'worker_signed') && audit.some(e => e.event === 'admin_signed'), 'audit log has both signature events');

  // ---- double countersign rejected ----
  const reCounter = await api('POST', '/api/documents/requests/SIG-LEGACY-PENDING/countersign', { signatureType: 'type', signatureData: 'x' });
  check(reCounter.status === 400, 'double countersign rejected');

  // ---- request detail exposes both signatures ----
  const detail = await api('GET', `/api/documents/requests/${reqId}`);
  check(detail.data.signature_type === 'type' && detail.data.admin_signature_type === 'type' && detail.data.admin_signed_by,
    'detail exposes worker + admin signatures');

  // ---- fully-signed request can't be cancelled ----
  const cancelDone = await api('POST', `/api/documents/requests/${reqId}/cancel`, {});
  check(cancelDone.status === 400, 'fully-signed request not cancellable', String(cancelDone.status));

  // ---- cancel works on worker_signed (legacy flow) ----
  await pool.query(
    `INSERT INTO signature_requests (id, document_id, worker_id, status, rendered_content)
     VALUES ('SIG-LEGACY-P2', ?, ?, 'pending', 'Legacy body')`,
    [tpl.data.id, WID]
  );
  await api('POST', '/api/documents/requests/SIG-LEGACY-P2/sign', { signatureType: 'type', signatureData: 'T' }, WTOKEN);
  const cancelWs = await api('POST', '/api/documents/requests/SIG-LEGACY-P2/cancel', {});
  check(cancelWs.status === 200, 'worker_signed request cancellable');

  // ---- decline still works ----
  const send3 = await api('POST', `/api/documents/${tpl.data.id}/send`, { workerId: WID });
  const dec = await api('POST', `/api/documents/requests/${send3.data.id}/decline`, {}, WTOKEN);
  check(dec.status === 200 && dec.data.status === 'declined', 'decline still works');
  const counterDeclined = await api('POST', `/api/documents/requests/${send3.data.id}/countersign`, { signatureType: 'type', signatureData: 'x' });
  check(counterDeclined.status === 400, 'countersign on declined rejected');

  // ---- legacy 'signed' request (pre-Part7) can be countersigned ----
  const [legacyReq] = await pool.query(
    `INSERT INTO signature_requests (id, document_id, worker_id, status, rendered_content, signed_content, signed_at)
     VALUES ('SIG-LEGACY-TEST', ?, ?, 'signed', 'Legacy body', 'Legacy body\nSigned by WKR', NOW())`,
    [tpl.data.id, WID]
  );
  const counterLegacy = await api('POST', '/api/documents/requests/SIG-LEGACY-TEST/countersign', {
    signatureType: 'draw', signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  });
  check(counterLegacy.status === 200 && counterLegacy.data.status === 'signed', 'legacy signed request countersigned');

  // ---- requests list exposes admin_signed_at ----
  const list = await api('GET', '/api/documents/requests');
  const inList = (list.data || []).find(x => x.id === reqId);
  check(inList?.admin_signed_at && inList?.admin_signed_by, 'list exposes admin_signed_at/by');

  // ---- cleanup ----
  await pool.query("DELETE FROM signature_requests WHERE id IN (?, ?, 'SIG-LEGACY-PENDING', 'SIG-LEGACY-P2', 'SIG-LEGACY-TEST')", [reqId, send3.data.id]);
  await pool.query('DELETE FROM documents WHERE id IN (?, ?)', [tpl.data.id, 'DOC-LEGACY-TEST']);
  await pool.query("DELETE FROM notifications WHERE id LIKE 'SGN-%'");
  const [leftover] = await pool.query("SELECT COUNT(*) c FROM signature_requests WHERE id LIKE 'SIG-LEGACY-TEST' OR document_id IN (?, ?)", [tpl.data.id, 'DOC-LEGACY-TEST']);
  check(leftover[0].c === 0, 'test data cleaned up');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
