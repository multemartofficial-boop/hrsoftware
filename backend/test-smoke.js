// Final regression: every existing admin/worker endpoint still responds.
require('dotenv').config();
const BASE = 'http://localhost:3001';
let ADMIN = '';

async function hit(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.status;
}

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

async function main() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  ADMIN = (await res.json()).token;
  console.log('Admin login OK\n=== SMOKE: ALL EXISTING ENDPOINTS ===');

  const adminGets = [
    ['/api/workers', 'Worker Directory'],
    ['/api/applications', 'Registration Approvals'],
    ['/api/attendance', 'Attendance'],
    ['/api/payroll', 'Payrolls'],
    ['/api/locations', 'Locations'],
    ['/api/attendance/active/shifts', 'Live Map (open shifts)'],
    ['/api/assignments', 'Daily Assignments'],
    ['/api/assignments/today', 'Today assignments'],
    ['/api/documents', 'Documents: templates'],
    ['/api/documents/requests', 'Documents: requests'],
    ['/api/buyer-income', 'Buyer income'],
    ['/api/other-costs', 'Other costs'],
    ['/api/settings', 'Settings'],
    ['/api/notifications', 'Notifications'],
    ['/api/notifications/expiry', 'Expiry notices'],
    ['/api/action-logs', 'Action History'],
    ['/api/incidents', 'Incidents'],
    ['/api/clients', 'Clients'],
  ];
  for (const [url, label] of adminGets) {
    const s = await hit('GET', url, null, ADMIN);
    check(s === 200, `${label} (${url}) -> ${s}`);
  }

  // Reports endpoint takes params
  const rs = await hit('GET', `/api/reports/summary?from=${new Date().toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`, null, ADMIN);
  check(rs === 200 || rs === 404 || rs === 400, `Reports summary -> ${rs}`);

  // Expiry + payroll endpoints
  const ex = await hit('GET', '/api/expiry/check', null, ADMIN);
  check(ex === 200 || ex === 404, `Expiry check -> ${ex}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
