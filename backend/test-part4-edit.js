// Part 4 focused tests: full worker edit + before/after audit logging.
require('dotenv').config();
const pool = require('./config/database');
const BASE = 'http://localhost:3001';
let ADMIN = '';

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const toLocalDate = (v) => v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10);

async function main() {
  const login = await api('POST', '/api/auth/login', { email: 'ashraf.milon@gmail.com', password: 'Milon@1234' });
  ADMIN = login.data.token;
  check(!!ADMIN, 'admin login');

  // pick any existing worker
  const [wrows] = await pool.query('SELECT * FROM workers ORDER BY id LIMIT 1');
  const w = wrows[0];
  check(!!w, 'found worker', w?.id);
  const wid = w.id;

  // snapshot for restore
  const snapshot = { ...w };

  // ---- full edit: every field at once ----
  const full = {
    name: 'Part4 Edited Name', phone: '07123456789', email: 'part4-edit@test.com',
    address: '99 Edit Lane', nid: 'ZZ999999Z', location: 'Test Location X', role: 'Senior Guard',
    joined: '2026-01-05', expiry: '2027-01-05',
    payType: 'salary', monthlySalary: 2750.50,
    workerType: 'Sub-contract', subcontractCompany: 'EditCo Ltd',
    passportCountry: 'GBR', passportNumber: 'P123456', passportExpiry: '2030-06-01',
    visaNumber: 'V654321', visaExpiry: '2028-03-15',
    siaBadgeNumber: 'SIA9999', siaBadgeExpiry: '2027-12-31',
    onLeave: true,
  };
  const r1 = await api('PUT', `/api/workers/${wid}`, full);
  check(r1.status === 200, 'full-field PUT accepted', JSON.stringify(r1.data).slice(0, 150));

  const [a1] = await pool.query('SELECT * FROM workers WHERE id = ?', [wid]);
  const g = a1[0];
  check(g.name === 'Part4 Edited Name' && g.phone === '07123456789' && g.email === 'part4-edit@test.com', 'identity fields saved');
  check(g.address === '99 Edit Lane' && g.nid === 'ZZ999999Z' && g.location === 'Test Location X' && g.role === 'Senior Guard', 'address/nid/location/role saved');
  check(toLocalDate(g.joined) === '2026-01-05' && toLocalDate(g.expiry) === '2027-01-05', 'joined/expiry saved', `${toLocalDate(g.joined)} ${toLocalDate(g.expiry)}`);
  check(g.pay_type === 'salary' && Math.abs(Number(g.monthly_salary) - 2750.5) < 0.01 && Number(g.rate) === 0, 'pay fields saved');
  check(g.worker_type === 'Sub-contract' && g.subcontract_company === 'EditCo Ltd', 'employment type saved');
  check(g.passport_country === 'GBR' && g.passport_number === 'P123456' && toLocalDate(g.passport_expiry) === '2030-06-01', 'passport fields saved');
  check(g.visa_number === 'V654321' && toLocalDate(g.visa_expiry) === '2028-03-15', 'visa fields saved');
  check(g.sia_badge_number === 'SIA9999' && toLocalDate(g.sia_badge_expiry) === '2027-12-31', 'SIA fields saved');
  check(g.on_leave === 1, 'on_leave saved');

  // ---- before/after audit log ----
  const [logs] = await pool.query(
    "SELECT details FROM action_logs WHERE action = 'updated_worker' AND target_id = ? ORDER BY id DESC LIMIT 1", [wid]);
  const det = logs[0] && (typeof logs[0].details === 'string' ? JSON.parse(logs[0].details) : logs[0].details);
  check(!!det?.changes, 'action log has changes map', JSON.stringify(det).slice(0, 200));
  check(det?.changes?.Name?.from === snapshot.name && det?.changes?.Name?.to === 'Part4 Edited Name',
    'name before/after recorded', JSON.stringify(det?.changes?.Name));
  check(det?.changes?.['Pay type']?.to === 'salary', 'pay type change recorded', JSON.stringify(det?.changes?.['Pay type']));
  check(det?.changes?.['Monthly salary']?.to === 2750.5, 'salary change recorded', JSON.stringify(det?.changes?.['Monthly salary']));
  check(det?.changes?.['Passport number']?.to === 'P123456', 'passport change recorded');
  check(det?.changes?.['Phone']?.to === '07123456789', 'phone change recorded', JSON.stringify(det?.changes?.Phone));

  // ---- partial update preserves untouched fields ----
  const r2 = await api('PUT', `/api/workers/${wid}`, { phone: '07999999999' });
  check(r2.status === 200, 'partial PUT accepted');
  const [a2] = await pool.query('SELECT * FROM workers WHERE id = ?', [wid]);
  check(a2[0].phone === '07999999999' && a2[0].name === 'Part4 Edited Name' && a2[0].email === 'part4-edit@test.com',
    'partial PUT preserved other fields');

  // ---- clearing a nullable date stores NULL ----
  const r3 = await api('PUT', `/api/workers/${wid}`, { visaExpiry: '' });
  const [a3] = await pool.query('SELECT visa_expiry FROM workers WHERE id = ?', [wid]);
  check(r3.status === 200 && a3[0].visa_expiry === null, 'empty date clears to NULL', String(a3[0].visa_expiry));

  // ---- validation still enforced ----
  const r4 = await api('PUT', `/api/workers/${wid}`, { payType: 'salary', monthlySalary: 0 });
  check(r4.status === 400, 'salary without amount rejected', String(r4.status));

  // ---- restore original worker state ----
  await pool.query(
    `UPDATE workers SET name=?, phone=?, email=?, location=?, role=?, rate=?, pay_type=?, monthly_salary=?,
       address=?, nid=?, on_leave=?, joined=?, expiry=?,
       passport_country=?, passport_number=?, passport_expiry=?,
       visa_number=?, visa_expiry=?, sia_badge_number=?, sia_badge_expiry=?,
       worker_type=?, subcontract_company=? WHERE id=?`,
    [snapshot.name, snapshot.phone, snapshot.email, snapshot.location, snapshot.role, snapshot.rate,
     snapshot.pay_type, snapshot.monthly_salary, snapshot.address, snapshot.nid, snapshot.on_leave,
     toLocalDate(snapshot.joined), toLocalDate(snapshot.expiry),
     snapshot.passport_country, snapshot.passport_number, snapshot.passport_expiry ? toLocalDate(snapshot.passport_expiry) : null,
     snapshot.visa_number, snapshot.visa_expiry ? toLocalDate(snapshot.visa_expiry) : null,
     snapshot.sia_badge_number, snapshot.sia_badge_expiry ? toLocalDate(snapshot.sia_badge_expiry) : null,
     snapshot.worker_type, snapshot.subcontract_company, wid]
  );
  const [restored] = await pool.query('SELECT name, phone FROM workers WHERE id = ?', [wid]);
  check(restored[0].name === snapshot.name && restored[0].phone === snapshot.phone, 'worker restored to original');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
