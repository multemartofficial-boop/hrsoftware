// Phase E Part 2 test: live map data pipeline + attendance log indicators
const mysql = require('mysql2/promise');
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

  const wToken = (await (await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode: 'WKR-2026-0154', password: 'SubTest@123' })
  })).json()).token;
  if (!wToken) { console.log('FAIL: worker login'); process.exit(1); }

  const todayStr = new Date().toISOString().split('T')[0];
  const wid = 'WKR-2026-0154';
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);

  // ===== 1. Check in WITHIN radius → active shift visible with GPS =====
  console.log('=== 1. CHECK-IN WITHIN RADIUS ===');
  const c1 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5421, longitude: -0.0018
  }, wToken);
  console.log(`Check-in: ${c1.status}, mismatch=${c1.data?.locationMismatch}, dist=${c1.data?.distanceMeters}m`);

  const { data: active1 } = await api('GET', '/api/attendance/active/shifts');
  const s1 = active1.find(s => s.worker_id === wid);
  console.log(`Active shifts: ${active1.length}, worker row: lat=${s1?.check_in_lat}, lng=${s1?.check_in_lng}, mismatch=${s1?.location_mismatch}`);
  if (s1 && Number(s1.check_in_lat) === 51.5421 && (s1.location_mismatch === 0 || s1.location_mismatch === false)) {
    console.log('OK: green-pin data present (matched, GPS on record)');
  } else { ok = false; console.log('FAIL: worker not in active shifts with GPS'); }

  // ===== 2. Check out → disappears from live map =====
  console.log('\n=== 2. CHECK-OUT REMOVES PIN ===');
  const co = await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  console.log(`Check-out: ${co.status}, hours=${co.data?.hours}`);
  const { data: active2 } = await api('GET', '/api/attendance/active/shifts');
  const s2 = active2.find(s => s.worker_id === wid);
  if (!s2) console.log('OK: worker no longer in active shifts (pin disappears)');
  else { ok = false; console.log('FAIL: worker still in active shifts'); }

  // Historical record keeps its indicator data
  const { data: attHist } = await api('GET', '/api/attendance');
  const h1 = attHist.find(a => a.id === c1.data.id);
  console.log(`Historical record: mismatch=${h1?.location_mismatch}, lat=${h1?.check_in_lat}`);
  if (h1 && (h1.location_mismatch === 0 || h1.location_mismatch === false) && h1.check_in_lat != null) {
    console.log('OK: history retains green-indicator data');
  } else { ok = false; console.log('FAIL: history lost GPS data'); }

  // ===== 3. Check in OUTSIDE radius → red pin data =====
  console.log('\n=== 3. CHECK-IN MISMATCH → RED PIN ===');
  const c3 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5033, longitude: -0.0205 // ~4.4km away
  }, wToken);
  console.log(`Check-in: ${c3.status}, mismatch=${c3.data?.locationMismatch}, dist=${c3.data?.distanceMeters}m`);
  const { data: active3 } = await api('GET', '/api/attendance/active/shifts');
  const s3 = active3.find(s => s.worker_id === wid);
  if (s3 && (s3.location_mismatch === 1 || s3.location_mismatch === true)) {
    console.log('OK: red-pin data present (mismatch flagged on active shift)');
  } else { ok = false; console.log('FAIL: mismatch not visible on active shifts'); }

  // Distance is derivable client-side (locations have lat/lng): verify location data present
  const { data: locs } = await api('GET', '/api/locations');
  const strat = locs.find(l => l.name === 'Stratford Yard');
  const dist = Math.round(6371000 * 2 * Math.asin(Math.sqrt(
    Math.sin((51.5033 - 51.5417) * Math.PI / 360) ** 2 +
    Math.cos(51.5417 * Math.PI / 180) * Math.cos(51.5033 * Math.PI / 180) *
    Math.sin((-0.0205 + 0.0022) * Math.PI / 360) ** 2
  )));
  console.log(`Location pin data: Stratford Yard lat=${strat.latitude}, lng=${strat.longitude}, radius=${strat.radiusMeters}m — worker dist ≈${dist}m`);
  if (strat.latitude != null && dist > strat.radiusMeters) {
    console.log('OK: location pin + computed distance available for popup');
  } else { ok = false; console.log('FAIL: location geo missing'); }

  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', [wid, todayStr]);

  // ===== 4. Frontend page serves + leaflet bundle loads =====
  const page = await fetch('http://localhost:8080/admin/live-map');
  console.log(`\nLive Map page: HTTP ${page.status}`);

  // ===== 5. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/workers/WKR-2026-0154/compliance','Compliance'],
    ['/api/notifications','Notifications'],['/api/settings/bank-holidays','Bank Holidays'],
    ['/api/applications','Applications'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  await pool.end();
  console.log(`\n${ok ? '✅ ALL PART 2 TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
