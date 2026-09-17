// Part 2 focused tests: hourly vs monthly-salary workers.
// Covers: worker pay-type update, payroll preview/generate for both types,
// proration, approval flow carrying pay type through password setup.
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

const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.02;

async function main() {
  // ---- login ----
  const login = await api('POST', '/api/auth/login', { email: 'ashraf.milon@gmail.com', password: 'Milon@1234' });
  ADMIN = login.data.token;
  check(!!ADMIN, 'admin login');

  // ---- pick an hourly worker WITH attendance ----
  const [wrows] = await pool.query(
    `SELECT w.id, w.rate, w.pay_type, COUNT(a.id) AS att
     FROM workers w JOIN attendance a ON a.worker_id = w.id
     GROUP BY w.id ORDER BY att DESC LIMIT 1`
  );
  check(wrows.length > 0, 'found a worker with attendance');
  const worker = wrows[0];
  const origRate = Number(worker.rate);
  check(worker.pay_type === 'hourly' || worker.pay_type == null, 'worker starts as hourly', `pay_type=${worker.pay_type}`);

  const toLocalDate = (v) => v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
  const [attRows] = await pool.query(
    'SELECT MIN(date) AS mn, MAX(date) AS mx FROM attendance WHERE worker_id = ?', [worker.id]);
  const from = toLocalDate(attRows[0].mn);
  const to = toLocalDate(attRows[0].mx);

  // ---- hourly preview (baseline) ----
  const p1 = await api('POST', '/api/payroll/preview', { workerId: worker.id, from, to, advance: 0 });
  check(p1.status === 200, 'hourly preview returns 200', JSON.stringify(p1.data).slice(0, 200));
  check(p1.data.payType === 'hourly', 'hourly preview payType = hourly', p1.data.payType);
  check(p1.data.gross > 0 && near(p1.data.hours, Number(p1.data.hours)), 'hourly preview has positive gross');
  const hourlyGross = p1.data.gross;

  // ---- convert worker to monthly salary via partial PUT ----
  const wBefore = await api('GET', `/api/workers/${worker.id}`);
  const upd = await api('PUT', `/api/workers/${worker.id}`, { payType: 'salary', monthlySalary: 2000 });
  check(upd.status === 200, 'PUT worker -> salary', JSON.stringify(upd.data).slice(0, 150));
  const wAfter = await api('GET', `/api/workers/${worker.id}`);
  check(wAfter.data.payType === 'salary', 'worker.payType now salary');
  check(near(Number(wAfter.data.monthlySalary), 2000), 'worker.monthlySalary = 2000', String(wAfter.data.monthlySalary));
  check(wAfter.data.name === wBefore.data.name && wAfter.data.email === wBefore.data.email, 'partial PUT preserved name/email');
  check(Number(wAfter.data.rate) === 0, 'salaried worker rate cleared to 0', String(wAfter.data.rate));

  // ---- salary previews ----
  // The proration is bounded by worker.joined — move it back temporarily so a
  // full calendar month of salary can be tested, then restore it below.
  const [jrows] = await pool.query('SELECT joined FROM workers WHERE id = ?', [worker.id]);
  const origJoined = jrows[0].joined;
  await pool.query('UPDATE workers SET joined = ? WHERE id = ?', ['2026-08-01', worker.id]);

  const fullMonth = await api('POST', '/api/payroll/preview', { workerId: worker.id, from: '2026-08-01', to: '2026-08-31', advance: 0 });
  check(fullMonth.status === 200, 'salary preview full month 200', JSON.stringify(fullMonth.data).slice(0, 200));
  check(fullMonth.data.payType === 'salary', 'preview payType salary');
  check(near(fullMonth.data.gross, 2000), 'full month gross = 2000.00', String(fullMonth.data.gross));
  check(fullMonth.data.rate === 0, 'salary preview does not use hourly rate', String(fullMonth.data.rate));

  const halfMonth = await api('POST', '/api/payroll/preview', { workerId: worker.id, from: '2026-08-01', to: '2026-08-15', advance: 0 });
  check(near(halfMonth.data.gross, r2(2000 * 15 / 31)), 'half month prorated = 967.74', String(halfMonth.data.gross));
  check((halfMonth.data.salaryBreakdown || [])[0]?.days === 15, 'breakdown shows 15/31 days', JSON.stringify(halfMonth.data.salaryBreakdown));

  const twoMonths = await api('POST', '/api/payroll/preview', { workerId: worker.id, from: '2026-08-16', to: '2026-09-15', advance: 0 });
  const expectedTwo = r2(2000 * 16 / 31) + r2(2000 * 15 / 30);
  check(near(twoMonths.data.gross, expectedTwo), 'two-month proration correct', `got ${twoMonths.data.gross} want ${expectedTwo}`);
  check((twoMonths.data.salaryBreakdown || []).length === 2, 'two-month breakdown has 2 entries');

  // zero attendance still pays salary (period inside employment)
  const noAtt = await api('POST', '/api/payroll/preview', { workerId: worker.id, from: '2026-08-16', to: '2026-08-31', advance: 0 });
  check(noAtt.status === 200 && near(noAtt.data.gross, r2(2000 * 16 / 31)), 'salaried pay needs no attendance', `status=${noAtt.status} gross=${noAtt.data.gross}`);

  // ---- generate a real salary payroll (while joined is still 2026-08-01) ----
  const gen = await api('POST', '/api/payroll', { workerId: worker.id, from: '2026-08-01', to: '2026-08-15', advance: 0 });
  check(gen.status === 201, 'salary payroll generated', JSON.stringify(gen.data).slice(0, 200));
  const genId = gen.data.id;
  const plist = await api('GET', `/api/payroll?workerId=${worker.id}`);
  const prow = (plist.data || []).find(p => p.id === genId);
  check(prow?.payType === 'salary', 'stored payroll payType salary');
  check(near(Number(prow?.monthlySalary), 2000), 'stored payroll monthlySalary 2000', String(prow?.monthlySalary));
  check((prow?.payDetails?.salaryBreakdown || [])[0]?.days === 15, 'payDetails snapshot stored', JSON.stringify(prow?.payDetails));
  if (genId) await api('DELETE', `/api/payroll/${genId}`);

  // restore original join date
  await pool.query('UPDATE workers SET joined = ? WHERE id = ?', [origJoined, worker.id]);

  // ---- summary endpoint honours salary ----
  const sum = await api('GET', '/api/payroll/summary?period=monthly');
  check(sum.status === 200, 'payroll summary 200');
  const srow = (sum.data || []).flatMap(p => p.workers).find(w => w.workerId === worker.id);
  check(!!srow && srow.payType === 'salary', 'summary marks worker salaried', srow ? srow.payType : 'not found');

  // ---- restore worker to hourly ----
  const back = await api('PUT', `/api/workers/${worker.id}`, { payType: 'hourly', rate: origRate, monthlySalary: null });
  check(back.status === 200, 'PUT worker -> back to hourly');
  const wBack = await api('GET', `/api/workers/${worker.id}`);
  check(wBack.data.payType === 'hourly', 'worker back to hourly');
  check(near(Number(wBack.data.rate), origRate), 'hourly rate restored', String(wBack.data.rate));
  const p2 = await api('POST', '/api/payroll/preview', { workerId: worker.id, from, to, advance: 0 });
  check(p2.status === 200 && near(p2.data.gross, hourlyGross), 'hourly payroll unchanged after round-trip', `${p2.data.gross} vs ${hourlyGross}`);

  // ---- approval flow with pay type ----
  const ts = Date.now();
  const appId = `APP-TEST-${ts}`;
  const email = `part2-${ts}@test.com`;
  await pool.query(
    `INSERT INTO registration_applications (id, name, submitted, phone, email, address, nid, applied_for, location, rate, status, details)
     VALUES (?, 'Part2 SalaryTest', NOW(), '07000000000', ?, '1 Test St', 'QQ000000A', 'Tester', 'Test Site', 0, 'pending', '{}')`,
    [appId, email]
  );
  const apS = await api('POST', `/api/applications/${appId}/approve`, { payType: 'salary', monthlySalary: 2400 });
  check(apS.status === 200, 'approve with monthly salary', JSON.stringify(apS.data).slice(0, 200));
  check(apS.data.payType === 'salary' && near(Number(apS.data.monthlySalary), 2400), 'approve returns payType + salary');

  const badApproveId = `APP-TEST-B${ts}`;
  await pool.query(
    `INSERT INTO registration_applications (id, name, submitted, phone, email, address, nid, applied_for, location, rate, status, details)
     VALUES (?, 'Part2 BadSalary', NOW(), '07000000001', ?, '1 Test St', 'QQ000000B', 'Tester', 'Test Site', 0, 'pending', '{}')`,
    [badApproveId, `part2b-${ts}@test.com`]
  );
  const apBad = await api('POST', `/api/applications/${badApproveId}/approve`, { payType: 'salary' });
  check(apBad.status === 400, 'salary approval without amount rejected', String(apBad.status));

  // hourly approval still works
  const apHId = `APP-TEST-H${ts}`;
  await pool.query(
    `INSERT INTO registration_applications (id, name, submitted, phone, email, address, nid, applied_for, location, rate, status, details)
     VALUES (?, 'Part2 HourlyTest', NOW(), '07000000002', ?, '1 Test St', 'QQ000000C', 'Tester', 'Test Site', 0, 'pending', '{}')`,
    [apHId, `part2h-${ts}@test.com`]
  );
  const apH = await api('POST', `/api/applications/${apHId}/approve`, { payType: 'hourly', rate: 15 });
  check(apH.status === 200 && apH.data.payType === 'hourly' && near(Number(apH.data.rate), 15), 'hourly approval unchanged', JSON.stringify(apH.data).slice(0, 150));

  // password setup -> worker row carries salary fields
  const token = (apS.data.setupLink || '').split('token=')[1];
  check(!!token, 'setup token present');
  const setup = await fetch(`${BASE}/api/auth/setup-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'TestPass123!' }),
  });
  const setupData = await setup.json();
  check(setup.status === 200, 'setup-password succeeds', JSON.stringify(setupData).slice(0, 150));
  const newW = await api('GET', `/api/workers/${apS.data.workerId}`);
  check(newW.data.payType === 'salary', 'new worker payType salary');
  check(near(Number(newW.data.monthlySalary), 2400), 'new worker monthlySalary 2400', String(newW.data.monthlySalary));
  check(Number(newW.data.rate) === 0, 'new worker has no hourly rate', String(newW.data.rate));

  // ---- cleanup ----
  if (apS.data.workerId) await api('DELETE', `/api/workers/${apS.data.workerId}`);
  await pool.query('DELETE FROM registration_applications WHERE id IN (?, ?, ?)', [appId, badApproveId, apHId]);
  await pool.query('DELETE FROM password_reset_tokens WHERE email LIKE ?', [`part2%-${ts}@test.com`.replace('%-', '%').replace('@test.com','%@test.com')]);
  await pool.query(`DELETE FROM password_reset_tokens WHERE email IN (?, ?, ?)`, [email, `part2b-${ts}@test.com`, `part2h-${ts}@test.com`]);
  await pool.query('DELETE FROM notifications WHERE worker IN (?, ?, ?)', ['Part2 SalaryTest', 'Part2 BadSalary', 'Part2 HourlyTest']);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
