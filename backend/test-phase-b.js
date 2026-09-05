// Phase B test: weekly/monthly/yearly payroll summary endpoint
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ashraf.milon@gmail.com', password: 'Milon@1234' })
  });
  const d = await res.json();
  if (!d.token) throw new Error('Login failed');
  TOKEN = d.token;
  console.log('Login OK');
}

async function main() {
  await login();

  // 1. Get raw attendance to cross-check
  const { data: att } = await api('GET', '/api/attendance');
  console.log(`\nTotal attendance records: ${att?.length ?? 0}`);
  if (att?.length) {
    // Group by worker to show adr Adrito's data
    const byWorker = {};
    for (const a of att) {
      if (!byWorker[a.worker_id]) byWorker[a.worker_id] = { name: a.worker, hours: 0, dates: [] };
      byWorker[a.worker_id].hours += Number(a.hours_worked);
      byWorker[a.worker_id].dates.push(a.date);
    }
    for (const [wid, w] of Object.entries(byWorker)) {
      console.log(`  ${wid}: ${w.name} — ${w.hours.toFixed(2)}h total, ${w.dates.length} records`);
    }
  }

  // 2. Test weekly summary
  console.log('\n=== WEEKLY SUMMARY ===');
  const { status: ws, data: weekly } = await api('GET', '/api/payroll/summary?period=weekly');
  console.log('Status:', ws);
  if (weekly?.length) {
    for (const p of weekly) {
      console.log(`  ${p.label}: ${p.hours.toFixed(2)}h, gross ${p.gross}, tax ${p.tax}, net ${p.net}`);
      for (const w of p.workers) {
        console.log(`    ${w.worker} (${w.workerId}): ${w.hours.toFixed(2)}h @ ${w.rate}, gross ${w.gross}, tax ${w.tax}, net ${w.net}`);
      }
    }
  } else {
    console.log('  (empty)');
  }

  // 3. Test monthly summary
  console.log('\n=== MONTHLY SUMMARY ===');
  const { status: ms, data: monthly } = await api('GET', '/api/payroll/summary?period=monthly');
  console.log('Status:', ms);
  if (monthly?.length) {
    for (const p of monthly) {
      console.log(`  ${p.label}: ${p.hours.toFixed(2)}h, gross ${p.gross}, tax ${p.tax}, net ${p.net}`);
      for (const w of p.workers) {
        console.log(`    ${w.worker} (${w.workerId}): ${w.hours.toFixed(2)}h @ ${w.rate}, gross ${w.gross}, tax ${w.tax}, net ${w.net}`);
      }
    }
  } else {
    console.log('  (empty)');
  }

  // 4. Test yearly summary
  console.log('\n=== YEARLY SUMMARY ===');
  const { status: ys, data: yearly } = await api('GET', '/api/payroll/summary?period=yearly');
  console.log('Status:', ys);
  if (yearly?.length) {
    for (const p of yearly) {
      console.log(`  ${p.label}: ${p.hours.toFixed(2)}h, gross ${p.gross}, tax ${p.tax}, net ${p.net}`);
      for (const w of p.workers) {
        console.log(`    ${w.worker} (${w.workerId}): ${w.hours.toFixed(2)}h @ ${w.rate}, gross ${w.gross}, tax ${w.tax}, net ${w.net}`);
      }
    }
  } else {
    console.log('  (empty)');
  }

  // 5. Cross-check: monthly totals should equal sum of weekly totals
  console.log('\n=== CROSS-CHECK ===');
  if (weekly?.length && monthly?.length) {
    const weeklyTotal = weekly.reduce((s, p) => s + p.hours, 0);
    const monthlyTotal = monthly.reduce((s, p) => s + p.hours, 0);
    const yearlyTotal = yearly?.reduce((s, p) => s + p.hours, 0) ?? 0;
    console.log(`Weekly total hours:  ${weeklyTotal.toFixed(2)}`);
    console.log(`Monthly total hours: ${monthlyTotal.toFixed(2)}`);
    console.log(`Yearly total hours:  ${yearlyTotal.toFixed(2)}`);
    const match = Math.abs(weeklyTotal - monthlyTotal) < 0.01 && Math.abs(monthlyTotal - yearlyTotal) < 0.01;
    console.log(match ? '✅ All period totals match' : '⚠️ Period totals differ');
  }

  // 6. Verify existing payroll endpoints still work
  console.log('\n=== EXISTING ENDPOINTS ===');
  const { status: ps } = await api('GET', '/api/payroll');
  console.log(`GET /api/payroll: ${ps === 200 ? '✅' : '❌'} (${ps})`);
  const { status: ss } = await api('GET', '/api/payroll/stats/summary');
  console.log(`GET /api/payroll/stats/summary: ${ss === 200 ? '✅' : '❌'} (${ss})`);
  const { status: as } = await api('GET', '/api/attendance');
  console.log(`GET /api/attendance: ${as === 200 ? '✅' : '❌'} (${as})`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
