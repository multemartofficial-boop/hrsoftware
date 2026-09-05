// Phase E Part 1 test: geofenced check-in
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

  // ===== 1. Add lat/lng/radius to a location =====
  console.log('=== 1. LOCATION GEO FIELDS ===');
  const { data: locs } = await api('GET', '/api/locations');
  const strat = locs.find(l => l.name === 'Stratford Yard');
  if (!strat) { console.log('FAIL: Stratford Yard not found'); process.exit(1); }

  // Stratford, London reference point: 51.5417, -0.0022
  const { status: updS } = await api('PUT', `/api/locations/${strat.id}`, {
    name: 'Stratford Yard', address: strat.address,
    latitude: 51.5417, longitude: -0.0022, radiusMeters: 200
  });
  console.log(`Update location geo: ${updS}`);

  const { data: locs2 } = await api('GET', '/api/locations');
  const strat2 = locs2.find(l => l.id === strat.id);
  console.log(`latitude=${strat2.latitude}, longitude=${strat2.longitude}, radiusMeters=${strat2.radiusMeters}`);
  if (Number(strat2.latitude) !== 51.5417 || strat2.radiusMeters !== 200) { ok = false; console.log('FAIL: geo fields not saved'); }
  else console.log('OK: geo fields saved + normalized');

  // ===== 2. Worker login + check-in WITHIN radius =====
  console.log('\n=== 2. CHECK-IN WITHIN RADIUS ===');
  const wr = await fetch(`${BASE}/api/auth/worker/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workerCode: 'WKR-2026-0154', password: 'SubTest@123' })
  });
  const wd = await wr.json();
  if (!wd.token) { console.log('FAIL: worker login'); process.exit(1); }
  const wToken = wd.token;

  const todayStr = new Date().toISOString().split('T')[0];
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', ['WKR-2026-0154', todayStr]);

  // ~50m away from 51.5417,-0.0022 → within 200m
  const c1 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5421, longitude: -0.0018
  }, wToken);
  console.log(`Check-in: status=${c1.status}, mismatch=${c1.data?.locationMismatch}, dist=${c1.data?.distanceMeters}m`);
  if (c1.status === 201 && c1.data?.locationMismatch === false) {
    console.log('OK: normal check-in, no mismatch');
  } else { ok = false; console.log('FAIL: expected 201 + no mismatch'); }

  // verify stored GPS on the record
  const [att1] = await pool.query('SELECT check_in_lat, check_in_lng, location_mismatch FROM attendance WHERE id = ?', [c1.data.id]);
  console.log(`Stored: lat=${att1[0]?.check_in_lat}, lng=${att1[0]?.check_in_lng}, mismatch=${att1[0]?.location_mismatch}`);
  if (Number(att1[0]?.check_in_lat) !== 51.5421 || att1[0]?.location_mismatch !== 0) { ok = false; console.log('FAIL: GPS not stored'); }
  else console.log('OK: raw GPS stored, mismatch=0');

  // check out + clean up
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', ['WKR-2026-0154', todayStr]);

  // ===== 3. Check-in OUTSIDE radius → allowed but flagged =====
  console.log('\n=== 3. CHECK-IN OUTSIDE RADIUS → FLAGGED ===');
  // Canary Wharf ~5km away
  const c2 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Stratford Yard', latitude: 51.5033, longitude: -0.0205
  }, wToken);
  console.log(`Check-in: status=${c2.status}, mismatch=${c2.data?.locationMismatch}, dist=${c2.data?.distanceMeters}m`);
  if (c2.status === 201 && c2.data?.locationMismatch === true && c2.data?.distanceMeters > 200) {
    console.log('OK: allowed but flagged as mismatch');
  } else { ok = false; console.log('FAIL: expected 201 + mismatch=true'); }

  const [att2] = await pool.query('SELECT check_in_lat, check_in_lng, location_mismatch FROM attendance WHERE id = ?', [c2.data.id]);
  console.log(`Stored: lat=${att2[0]?.check_in_lat}, lng=${att2[0]?.check_in_lng}, mismatch=${att2[0]?.location_mismatch}`);
  if (att2[0]?.location_mismatch !== 1) { ok = false; console.log('FAIL: mismatch flag not stored'); }
  else console.log('OK: mismatch flag persisted');

  // Admin attendance list should expose the flag
  const { data: attList } = await api('GET', '/api/attendance');
  const attRow = attList.find(a => a.id === c2.data.id);
  console.log(`Admin attendance row: location_mismatch=${attRow?.location_mismatch}, check_in_lat=${attRow?.check_in_lat}`);
  if (attRow?.location_mismatch !== 1 && attRow?.location_mismatch !== true) { ok = false; console.log('FAIL: admin list missing flag'); }
  else console.log('OK: flag visible to admin');

  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', ['WKR-2026-0154', todayStr]);

  // ===== 4. Missing GPS → rejected =====
  console.log('\n=== 4. NO GPS → REJECTED ===');
  const c3 = await api('POST', '/api/worker/attendance/checkin', { location: 'Stratford Yard' }, wToken);
  console.log(`Check-in without GPS: status=${c3.status} — "${c3.data?.error}"`);
  if (c3.status === 400 && /location access/i.test(c3.data?.error || '')) {
    console.log('OK: server rejects check-in without GPS');
  } else { ok = false; console.log('FAIL: expected 400 location-required error'); }

  // ===== 5. Location without geo → check-in works, no flag =====
  console.log('\n=== 5. LOCATION WITHOUT GEO CONFIGURED ===');
  const camden = locs2.find(l => l.name === 'Camden Site');
  console.log(`Camden geo: lat=${camden?.latitude}, lng=${camden?.longitude}`);
  const c4 = await api('POST', '/api/worker/attendance/checkin', {
    location: 'Camden Site', latitude: 51.5, longitude: -0.12
  }, wToken);
  console.log(`Check-in (no geo on location): status=${c4.status}, mismatch=${c4.data?.locationMismatch}, dist=${c4.data?.distanceMeters}`);
  if (c4.status === 201 && c4.data?.locationMismatch === false) {
    console.log('OK: check-in works, no flag when location has no coordinates');
  } else { ok = false; console.log('FAIL: expected 201 + no mismatch'); }
  await api('POST', '/api/worker/attendance/checkout', {}, wToken);
  await pool.query('DELETE FROM attendance WHERE worker_id = ? AND date = ?', ['WKR-2026-0154', todayStr]);

  // ===== 6. Smoke =====
  console.log('\n=== SMOKE TESTS ===');
  for (const [url, label] of [
    ['/api/workers','Workers'],['/api/attendance','Attendance'],['/api/payroll','Payroll'],
    ['/api/locations','Locations'],['/api/notifications','Notifications'],
    ['/api/settings','Settings'],['/api/applications','Applications'],
  ]) {
    const { status } = await api('GET', url);
    console.log(`${status === 200 ? 'OK' : 'FAIL'} ${status} ${label}`);
    if (status !== 200) ok = false;
  }

  await pool.end();
  console.log(`\n${ok ? '✅ ALL PART 1 TESTS PASSED' : '⚠️ Some checks failed'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
