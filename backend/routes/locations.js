const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActionFromReq } = require('../utils/action-log');

// Generate location ID
const generateLocationId = () => {
  return `LOC-${Date.now()}`;
};

// Public: Get all locations (for registration form + worker check-in)
router.get('/', async (req, res) => {
  try {
    const [locations] = await pool.query('SELECT * FROM locations ORDER BY name');
    res.json(locations.map(l => ({
      ...l,
      latitude: l.latitude !== null && l.latitude !== undefined ? Number(l.latitude) : null,
      longitude: l.longitude !== null && l.longitude !== undefined ? Number(l.longitude) : null,
      radiusMeters: l.radius_meters !== null && l.radius_meters !== undefined ? Number(l.radius_meters) : 25
    })));
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: true, message: 'Failed to load locations' });
  }
});

// Compose a display address line from structured parts.
const composeAddress = ({ building, street, city, postcode }) =>
  [building, street, city, postcode].filter(Boolean).join(', ');

// Admin: look up a UK postcode and list the buildings at it (Part 5).
// postcodes.io validates the postcode and gives the area centre; Photon
// (OpenStreetMap) supplies the individual buildings/addresses there.
router.get('/address-search', requireAuth, requireAdmin, async (req, res) => {
  const raw = String(req.query.postcode || '').trim();
  if (!raw) return res.status(400).json({ error: 'postcode is required' });

  const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  try {
    // 1) Validate + locate the postcode
    const pcRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (pcRes.status === 404) {
      return res.status(404).json({ error: 'Postcode not found — check the spelling and try again.' });
    }
    if (!pcRes.ok) throw new Error(`postcodes.io ${pcRes.status}`);
    const pc = (await pcRes.json()).result;

    const centre = {
      latitude: pc.latitude,
      longitude: pc.longitude,
      district: pc.admin_district || pc.parish || null,
      region: pc.region || null,
    };
    const postcode = (pc.postcode || raw).toUpperCase();

    // 2) Buildings at this postcode via OpenStreetMap's Overpass API:
    //    every node/way with an addr:housenumber or addr:postcode tag, plus
    //    named buildings, within 300 m of the postcode centre.
    const overpassQ = `[out:json][timeout:15];
(
  node["addr:housenumber"](around:300,${pc.latitude},${pc.longitude});
  way["addr:housenumber"](around:300,${pc.latitude},${pc.longitude});
  node["addr:postcode"](around:300,${pc.latitude},${pc.longitude});
  way["addr:postcode"](around:300,${pc.latitude},${pc.longitude});
  way[building]["name"](around:300,${pc.latitude},${pc.longitude});
);
out center tags 60;`;
    // Overpass rate-limits rapid repeats — try the main server, then a mirror.
    const overpassFetch = async (base) => {
      const r = await fetch(`${base}/api/interpreter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass rejects requests without an identifying User-Agent (406)
          'User-Agent': 'WorkHR-LocationPicker/1.0',
        },
        body: `data=${encodeURIComponent(overpassQ)}`,
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`overpass ${r.status}`);
      return (await r.json()).elements || [];
    };
    let elements = [];
    for (const base of ['https://overpass-api.de', 'https://overpass.kumi.systems']) {
      try { elements = await overpassFetch(base); break; } catch (e) {
        console.error(`Overpass ${base} failed:`, e.message);
      }
    }

    const haversine = (lat1, lon1, lat2, lon2) => {
      const R = 6371000, r = (d) => (d * Math.PI) / 180;
      const a = Math.sin(r(lat2 - lat1) / 2) ** 2 +
        Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    const seen = new Set();
    const mapped = [];
    for (const el of elements) {
      const t = el.tags || {};
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) continue;
      const building = t['addr:housename'] || t.name || t['addr:housenumber'] || null;
      const street = t['addr:street'] || null;
      const city = t['addr:city'] || pc.admin_district || null;
      const addrPc = t['addr:postcode'] ? String(t['addr:postcode']).toUpperCase() : null;
      const label = composeAddress({ building, street, city, postcode: addrPc }) || 'Address';
      const key = norm(label);
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push({
        building, street, city, postcode: addrPc,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        exactPostcode: norm(addrPc) === norm(postcode),
        distanceMeters: Math.round(haversine(pc.latitude, pc.longitude, lat, lng)),
        label,
      });
    }

    // Exact-postcode buildings first, then the nearest address-tagged
    // buildings (sparse OSM coverage fallback).
    const exact = mapped.filter((m) => m.exactPostcode);
    const nearby = mapped
      .filter((m) => !m.exactPostcode)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    const addresses = [...exact, ...nearby].slice(0, 30);

    res.json({ postcode, centre, addresses });
  } catch (error) {
    console.error('Address search error:', error);
    res.status(502).json({ error: 'Address lookup failed — check your connection and try again.' });
  }
});

// Admin: Create location
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, latitude, longitude, radiusMeters } = req.body;
    const building = req.body.building || null;
    const street = req.body.street || null;
    const city = req.body.city || null;
    const postcode = req.body.postcode ? String(req.body.postcode).toUpperCase() : null;
    const address = req.body.address || composeAddress({ building, street, city, postcode }) || null;
    const locationId = generateLocationId();

    await pool.query(
      'INSERT INTO locations (id, name, address, building, street, city, postcode, latitude, longitude, radius_meters) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [locationId, name, address, building, street, city, postcode,
       latitude != null && latitude !== '' ? Number(latitude) : null,
       longitude != null && longitude !== '' ? Number(longitude) : null,
       radiusMeters != null && radiusMeters !== '' ? Number(radiusMeters) : 25]
    );

    await logActionFromReq(req, 'added_location', 'location', locationId, { name, address });
    res.status(201).json({ id: locationId, message: 'Location created successfully' });
  } catch (error) {
    console.error('Create location error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update location
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const { name, latitude, longitude, radiusMeters } = req.body;

    // Get old location name for updating workers
    const [oldLocation] = await connection.query(
      'SELECT name, address FROM locations WHERE id = ?',
      [req.params.id]
    );

    if (oldLocation.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Location not found' });
    }

    const oldName = oldLocation[0].name;
    const building = req.body.building || null;
    const street = req.body.street || null;
    const city = req.body.city || null;
    const postcode = req.body.postcode ? String(req.body.postcode).toUpperCase() : null;
    const address = req.body.address || composeAddress({ building, street, city, postcode }) || oldLocation[0].address || null;

    // Update location
    await connection.query(
      'UPDATE locations SET name = ?, address = ?, building = ?, street = ?, city = ?, postcode = ?, latitude = ?, longitude = ?, radius_meters = ? WHERE id = ?',
      [name, address, building, street, city, postcode,
       latitude != null && latitude !== '' ? Number(latitude) : null,
       longitude != null && longitude !== '' ? Number(longitude) : null,
       radiusMeters != null && radiusMeters !== '' ? Number(radiusMeters) : 25,
       req.params.id]
    );
    
    // Update workers if location name changed
    if (name !== oldName) {
      await connection.query(
        'UPDATE workers SET location = ? WHERE location = ?',
        [name, oldName]
      );
      
      await connection.query(
        'UPDATE attendance SET location = ? WHERE location = ?',
        [name, oldName]
      );
    }
    
    await connection.commit();
    await logActionFromReq(req, 'edited_location', 'location', req.params.id, {
      before: { name: oldName },
      after: { name, address },
    });
    res.json({ message: 'Location updated successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    connection.release();
  }
});

// Admin: Delete location
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name, address FROM locations WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM locations WHERE id = ?', [req.params.id]);
    await logActionFromReq(req, 'deleted_location', 'location', req.params.id, {
      name: rows[0]?.name, address: rows[0]?.address,
    });
    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Delete location error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get workers count by location
router.get('/:name/workers-count', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [count] = await pool.query(
      'SELECT COUNT(*) as count FROM workers WHERE location = ?',
      [req.params.name]
    );
    res.json({ count: count[0].count });
  } catch (error) {
    console.error('Get workers count error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
