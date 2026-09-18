// Part 11 focused test: payroll payment status + permanent payment log.
// Usage: node test-part11-payments.js  (server must be running on :3001)
require('dotenv').config();
const pool = require('./config/database');

const base = 'http://localhost:3001/api';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); };

(async () => {
  const lr = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' }),
  });
  if (!lr.ok) { console.log('login failed', lr.status); process.exit(1); }
  const { token } = await lr.json();
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  const [w] = await pool.query('SELECT id FROM workers LIMIT 1');
  if (!w.length) { console.log('no workers'); process.exit(1); }
  const wid = w[0].id;
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    'INSERT INTO attendance (id,worker_id,worker,date,check_in_time,check_out_time,location,hours_worked) VALUES (?,?,?,?,?,?,?,?)',
    ['P11-TEST', wid, 'P11 Test', today, '09:00', '17:00', 'TestLoc', 8]
  );

  // generate
  const gr = await fetch(base + '/payroll', { method: 'POST', headers: H, body: JSON.stringify({ workerId: wid, from: today, to: today, advance: 0 }) });
  const gen = await gr.json();
  check('generate payroll', gr.status === 201, 'HTTP ' + gr.status);
  const pid = gen.id;
  if (!pid) { console.log(JSON.stringify(gen).slice(0, 200)); process.exit(1); }

  let [log] = await pool.query('SELECT action,status FROM payroll_payment_log WHERE payroll_id=? ORDER BY id', [pid]);
  check('log: generated', log.length === 1 && log[0].action === 'generated' && log[0].status === 'Pending');

  // mark paid with reference
  const pr = await fetch(base + `/payroll/${pid}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'Paid', paymentReference: 'BACS-P11-001' }) });
  check('mark paid', pr.ok, 'HTTP ' + pr.status);
  const [row1] = await pool.query('SELECT status,paid_at,paid_by,payment_reference FROM payroll WHERE id=?', [pid]);
  check('paid fields set', row1[0].status === 'Paid' && !!row1[0].paid_at && !!row1[0].paid_by && row1[0].payment_reference === 'BACS-P11-001', JSON.stringify(row1[0]));
  [log] = await pool.query('SELECT action FROM payroll_payment_log WHERE payroll_id=? ORDER BY id', [pid]);
  check('log: marked_paid', log.length === 2 && log[1].action === 'marked_paid');

  // revert
  const rr = await fetch(base + `/payroll/${pid}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'Pending' }) });
  check('revert pending', rr.ok);
  const [row2] = await pool.query('SELECT status,paid_at,paid_by,payment_reference FROM payroll WHERE id=?', [pid]);
  check('paid fields cleared', row2[0].status === 'Pending' && row2[0].paid_at === null && row2[0].paid_by === null && row2[0].payment_reference === null);
  [log] = await pool.query('SELECT action FROM payroll_payment_log WHERE payroll_id=? ORDER BY id', [pid]);
  check('log: reverted_pending', log.length === 3 && log[2].action === 'reverted_pending');

  // legacy 'Completed' alias
  const lr2 = await fetch(base + `/payroll/${pid}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'Completed' }) });
  check('legacy Completed alias accepted', lr2.ok);
  const [row3] = await pool.query('SELECT status FROM payroll WHERE id=?', [pid]);
  check('stored as Paid', row3[0].status === 'Paid');

  // GET normalization exposes paid fields
  const all = await (await fetch(base + '/payroll', { headers: H })).json();
  const mine = all.find(p => p.id === pid);
  check('GET returns status/paidAt/paidBy', !!mine && mine.status === 'Paid' && !!mine.paidAt && !!mine.paidBy, JSON.stringify({ s: mine && mine.status, at: mine && mine.paidAt, by: mine && mine.paidBy }));

  // delete -> permanent record
  const dr = await fetch(base + `/payroll/${pid}`, { method: 'DELETE', headers: H });
  check('delete', dr.ok);
  const [gone] = await pool.query('SELECT id FROM payroll WHERE id=?', [pid]);
  check('payroll row deleted', gone.length === 0);
  [log] = await pool.query('SELECT action,status FROM payroll_payment_log WHERE payroll_id=? ORDER BY id', [pid]);
  const actions = log.map(l => l.action);
  check('permanent log survives delete', log.length === 5 && actions[4] === 'deleted' && log[4].status === 'Paid', actions.join(','));

  const pl = await (await fetch(base + '/payroll/payment-log', { headers: H })).json();
  check('GET /payment-log returns deleted record', Array.isArray(pl) && pl.some(e => e.payrollId === pid && e.action === 'deleted' && e.netPay != null));

  // invalid status rejected
  const bad = await fetch(base + `/payroll/${pid}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'Banana' }) });
  check('invalid status rejected', bad.status === 400 || bad.status === 404);

  // cleanup
  await pool.query('DELETE FROM payroll_payment_log WHERE payroll_id=?', [pid]);
  await pool.query('DELETE FROM attendance WHERE id=?', ['P11-TEST']);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
