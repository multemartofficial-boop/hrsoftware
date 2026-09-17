// Part 6 focused tests: clients are admin-only reference records — no login/portal.
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

async function main() {
  const login = await api('POST', '/api/auth/login', { email: 'ashraf.milon@gmail.com', password: 'Milon@1234' }, '');
  ADMIN = login.data.token;
  check(!!ADMIN, 'admin login');

  // ---- portal endpoints gone ----
  const p1 = await api('GET', '/api/client/overview');
  check(p1.status === 404, 'portal /api/client/overview removed', String(p1.status));
  const p2 = await api('POST', '/api/auth/client/login', { email: 'x@x.com', password: 'xxxxxx' }, '');
  check(p2.status === 404, 'client login endpoint removed', String(p2.status));

  // ---- create reference record (no password, no users row) ----
  const [locs] = await pool.query('SELECT id FROM locations ORDER BY name LIMIT 2');
  const locIds = locs.map(l => l.id);
  const c = await api('POST', '/api/clients', {
    company: 'Part6 Facilities Ltd',
    email: 'ops@part6.com',
    phone: '020 7000 1111',
    address: '5 Reference Road, London, E1 1AA',
    status: 'Active',
    notes: 'Test notes — night contract.',
    locationIds: locIds,
  });
  check(c.status === 201, 'create client record', JSON.stringify(c.data).slice(0, 120));
  const cid = c.data.id;

  const [crows] = await pool.query('SELECT * FROM clients WHERE id = ?', [cid]);
  const row = crows[0];
  check(row.user_id === null, 'no users row / login created', String(row.user_id));
  check(row.company === 'Part6 Facilities Ltd' && row.email === 'ops@part6.com' && row.phone === '020 7000 1111', 'contact fields stored');
  check(row.address === '5 Reference Road, London, E1 1AA' && row.status === 'Active' && row.notes === 'Test notes — night contract.', 'address/status/notes stored');
  const [linked] = await pool.query('SELECT COUNT(*) c FROM client_locations WHERE client_id = ?', [cid]);
  check(linked[0].c === locIds.length, 'locations linked', String(linked[0].c));

  // ---- list serialization ----
  const list = await api('GET', '/api/clients');
  const item = (list.data || []).find(x => x.id === cid);
  check(item?.status === 'Active' && item?.phone === '020 7000 1111' && (item?.locations || []).length === locIds.length,
    'list returns new fields + locations', JSON.stringify({ s: item?.status, l: item?.locations?.length }));

  // ---- update ----
  const u = await api('PUT', `/api/clients/${cid}`, { status: 'Inactive', notes: 'Updated note', locationIds: [] });
  check(u.status === 200, 'update client');
  const [crows2] = await pool.query('SELECT status, notes FROM clients WHERE id = ?', [cid]);
  check(crows2[0].status === 'Inactive' && crows2[0].notes === 'Updated note', 'status/notes updated');
  const [linked2] = await pool.query('SELECT COUNT(*) c FROM client_locations WHERE client_id = ?', [cid]);
  check(linked2[0].c === 0, 'location links cleared');

  // ---- invalid location rejected ----
  const bad = await api('PUT', `/api/clients/${cid}`, { locationIds: ['LOC-NOPE'] });
  check(bad.status === 400, 'unknown location rejected', String(bad.status));

  // ---- legacy client rows still list fine ----
  check(Array.isArray(list.data), 'existing clients still listed');

  // ---- cleanup ----
  const d = await api('DELETE', `/api/clients/${cid}`);
  check(d.status === 200, 'delete client record');
  const [gone] = await pool.query('SELECT COUNT(*) c FROM clients WHERE id = ?', [cid]);
  check(gone[0].c === 0, 'record deleted');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
