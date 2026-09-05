// Phase C test: UK bank holiday pay
const BASE = 'http://localhost:3001';
let TOKEN = '';

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Login failed');
  TOKEN = d.token;
  console.log('Login OK\n');
}

async function main() {
  await login();

  // 1. List seeded bank holidays
  console.log('=== BANK HOLIDAYS LIST ===');
  const { status: hs, data: hols } = await api('GET', '/api/settings/bank-holidays');
  console.log('Status:', hs, '| count:', hols?.length);
  hols?.forEach(h => console.log(`  ${h.date} — ${h.name}`));

  // 2. Find the existing attendance date
  const { data: att } = await api('GET', '/api/attendance');
  const attRow = att?.[0];
  if (!attRow) { console.log('No attendance to test against'); process.exit(1); }
  const attDate = String(attRow.date).slice(0, 10);
  const attHours = Number(attRow.hours_worked);
  console.log(`\nExisting attendance: ${attRow.worker} (${attRow.worker_id}) on ${attDate}, ${attHours}h`);

  // 3. Get current settings (holiday multiplier)
  const { data: settings } = await api('GET', '/api/settings');
  const mult = Number(settings.holidayPayMultiplier ?? 2);
  const rate = 45; // WKR-2026-0152 rate observed earlier; will verify from workers list
  const { data: workers } = await api('GET', '/api/workers');
  const w = workers.find(x => x.id === attRow.worker_id);
  const workerRate = Number(w?.rate ?? rate);
  console.log(`Holiday multiplier: ${mult}x | worker rate: £${workerRate}/h`);

  // 4. Preview BEFORE adding the attendance date as a holiday
  const from = attDate, to = attDate;
  const { data: before } = await api('POST', '/api/payroll/preview', { workerId: attRow.worker_id, from, to, advance: 0 });
  console.log(`\nPREVIEW (no holiday): hours=${before.hours}, holidayHours=${before.holidayHours}, holidayPay=${before.holidayPay}, gross=${before.gross}, net=${before.net}`);

  // 5. Add the attendance date as a bank holiday
  const { status: addS, data: after } = await api('POST', '/api/settings/bank-holidays', { date: attDate, name: 'Test Holiday' });
  console.log(`\nAdd holiday ${attDate}: status ${addS}`);

  // 6. Preview AFTER — holiday hours should appear
  const { data: prev } = await api('POST', '/api/payroll/preview', { workerId: attRow.worker_id, from, to, advance: 0 });
  console.log(`PREVIEW (holiday):  hours=${prev.hours}, regularHours=${prev.regularHours}, holidayHours=${prev.holidayHours}, holidayPay=${prev.holidayPay}, gross=${prev.gross}, net=${prev.net}`);

  const expectedHolidayPay = attHours * workerRate * mult;
  const expectedGross = expectedHolidayPay; // all hours are holiday hours
  const holidayOk = Math.abs(prev.holidayHours - attHours) < 0.01 &&
                    Math.abs(prev.holidayPay - expectedHolidayPay) < 0.01 &&
                    Math.abs(prev.gross - expectedGross) < 0.01;
  console.log(`Expected: holidayHours=${attHours}, holidayPay=${expectedHolidayPay.toFixed(2)}, gross=${expectedGross.toFixed(2)}`);
  console.log(holidayOk ? '✅ Holiday pay applied correctly in preview' : '❌ Holiday pay MISMATCH in preview');
  console.log(`Gross uplift vs no-holiday: ${(prev.gross - before.gross).toFixed(2)} (expected ${(expectedHolidayPay - before.gross).toFixed(2)})`);

  // 7. Generate actual payroll covering the holiday date
  const { status: gs, data: gen } = await api('POST', '/api/payroll', { workerId: attRow.worker_id, from, to, advance: 0 });
  console.log(`\nGenerate payroll: status ${gs}`);
  if (gs === 201) {
    console.log(`  holidayHours=${gen.holidayHours}, holidayPay=${gen.holidayPay}, gross=${gen.gross}, net=${gen.net}`);
    const genOk = Math.abs(gen.holidayHours - attHours) < 0.01 && Math.abs(gen.holidayPay - expectedHolidayPay) < 0.01;
    console.log(genOk ? '✅ Generated payroll stores holiday breakdown' : '❌ Generated payroll holiday MISMATCH');
    // Verify it round-trips through GET /api/payroll
    const { data: plist } = await api('GET', '/api/payroll');
    const rec = plist.find(p => p.id === gen.id);
    console.log(`  Stored record: holidayHours=${rec?.holidayHours}, holidayPay=${rec?.holidayPay}`);
    // Clean up test payroll record
    await api('DELETE', `/api/payroll/${gen.id}`);
    console.log('  (test payroll record deleted)');
  }

  // 8. Check weekly/monthly/yearly summaries reflect holiday pay
  console.log('\n=== SUMMARY VIEWS (with holiday) ===');
  for (const period of ['weekly', 'monthly', 'yearly']) {
    const { data: sum } = await api('GET', `/api/payroll/summary?period=${period}`);
    const p = sum?.find(x => x.workers?.some(wk => wk.workerId === attRow.worker_id));
    if (p) {
      const ww = p.workers.find(wk => wk.workerId === attRow.worker_id);
      console.log(`${period}: ${p.label} — holidayHours=${p.holidayHours}, holidayPay=${p.holidayPay}, gross=${p.gross} | worker holidayHours=${ww.holidayHours}, holidayPay=${ww.holidayPay}`);
      const ok = Math.abs(ww.holidayHours - attHours) < 0.01 && Math.abs(ww.holidayPay - expectedHolidayPay) < 0.01;
      console.log(`  ${ok ? '✅' : '❌'} ${period} summary holiday pay`);
    } else {
      console.log(`${period}: ❌ worker not found in summary`);
    }
  }

  // 9. Remove the test holiday and confirm calculation reverts
  const { data: holsNow } = await api('GET', '/api/settings/bank-holidays');
  const testHol = holsNow?.find(h => h.date === attDate && h.name === 'Test Holiday');
  if (testHol) {
    const { status: delS } = await api('DELETE', `/api/settings/bank-holidays/${testHol.id}`);
    console.log(`\nRemove test holiday: status ${delS}`);
    const { data: after2 } = await api('POST', '/api/payroll/preview', { workerId: attRow.worker_id, from, to, advance: 0 });
    console.log(`PREVIEW (holiday removed): holidayHours=${after2.holidayHours}, gross=${after2.gross}`);
    console.log(after2.holidayHours === 0 ? '✅ Removing holiday reverts calculation — no code change needed' : '❌ Holiday still applied after removal');
  }

  // 10. Smoke test existing endpoints
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/buyer-income','Buyer Income'],['/api/other-costs','Other Costs'],
    ['/api/reports/dashboard','Reports'],['/api/settings','Settings'],['/api/applications','Applications'],
    ['/api/notifications','Notifications'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
