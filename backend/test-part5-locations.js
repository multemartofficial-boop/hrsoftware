// Part 5 focused tests: UK postcode -> building lookup + structured location storage.
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

async function main() {
  const login = await api('POST', '/api/auth/login', { email: 'ashraf.milon@gmail.com', password: 'Milon@1234' });
  ADMIN = login.data.token;
  check(!!ADMIN, 'admin login');

  // ---- postcode lookup: SW1A 1AA (Buckingham Palace — dense OSM coverage) ----
  const s1 = await api('GET', '/api/locations/address-search?postcode=SW1A%201AA');
  check(s1.status === 200, 'address-search 200', JSON.stringify(s1.data).slice(0, 150));
  check(s1.data.postcode === 'SW1A 1AA', 'normalised postcode returned', s1.data.postcode);
  check(typeof s1.data.centre?.latitude === 'number' && typeof s1.data.centre?.longitude === 'number', 'postcode centre has coords');
  check(Array.isArray(s1.data.addresses), 'addresses array returned');
  if (s1.data.addresses?.length) {
    const a = s1.data.addresses[0];
    check(typeof a.latitude === 'number' && typeof a.longitude === 'number', 'address has lat/lng');
    check(!!a.label, 'address has display label', a.label);
  } else {
    console.log('  (info) no buildings listed for SW1A 1AA — centre fallback still available');
  }

  // ---- invalid postcode rejected ----
  const s2 = await api('GET', '/api/locations/address-search?postcode=ZZ99ZZ');
  check(s2.status === 404, 'invalid postcode -> 404', String(s2.status));

  // ---- create location with structured fields ----
  const c = await api('POST', '/api/locations', {
    name: 'Part5 Test Building',
    building: '10',
    street: 'Test Street',
    city: 'London',
    postcode: 'SW1A 1AA',
    latitude: 51.5014, longitude: -0.1419, radiusMeters: 100,
  });
  check(c.status === 201, 'create location with structured address', JSON.stringify(c.data).slice(0, 120));
  const locId = c.data.id;

  const list = await api('GET', '/api/locations');
  const loc = (list.data || []).find(l => l.id === locId);
  check(!!loc, 'location returned in list');
  check(loc?.building === '10' && loc?.street === 'Test Street' && loc?.city === 'London' && loc?.postcode === 'SW1A 1AA',
    'structured fields stored', JSON.stringify({ b: loc?.building, s: loc?.street, c: loc?.city, p: loc?.postcode }));
  check(loc?.address === '10, Test Street, London, SW1A 1AA', 'address composed from parts', loc?.address);
  check(loc?.latitude === 51.5014 && loc?.longitude === -0.1419 && loc?.radiusMeters === 100, 'geofence coords+radius stored');

  // ---- update location ----
  const u = await api('PUT', `/api/locations/${locId}`, {
    name: 'Part5 Renamed', building: '12', street: 'New Street', city: 'London',
    postcode: 'SW1A 1AA', latitude: 51.5, longitude: -0.14, radiusMeters: 150,
  });
  check(u.status === 200, 'update location');
  const list2 = await api('GET', '/api/locations');
  const loc2 = (list2.data || []).find(l => l.id === locId);
  check(loc2?.building === '12' && loc2?.street === 'New Street' && loc2?.radiusMeters === 150, 'structured update stored');

  // ---- cleanup ----
  await api('DELETE', `/api/locations/${locId}`);
  const list3 = await api('GET', '/api/locations');
  check(!(list3.data || []).some(l => l.id === locId), 'test location deleted');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
