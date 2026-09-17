const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActionFromReq } = require('../utils/action-log');

const generateClientId = () => `CLT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Clients are internal admin-only reference records (Part 6): company details
// plus which locations belong to them. They have no login or portal access —
// legacy user_id links are kept on old rows but new records get NULL.
const loadClientLocations = async (clientIds) => {
  if (!clientIds.length) return {};
  const ph = clientIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT cl.client_id, cl.location_id, l.name, l.address
     FROM client_locations cl JOIN locations l ON l.id = cl.location_id
     WHERE cl.client_id IN (${ph}) ORDER BY l.name`,
    clientIds
  );
  const map = {};
  for (const r of rows) {
    (map[r.client_id] ||= []).push({ id: r.location_id, name: r.name, address: r.address });
  }
  return map;
};

const serialize = (row, locMap) => ({
  id: row.id,
  name: row.name,
  company: row.company,
  email: row.email,
  phone: row.phone,
  address: row.address,
  status: row.status || 'Active',
  notes: row.notes,
  locations: locMap[row.id] || [],
  createdAt: row.created_at,
});

// Admin: list all client records
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    const locMap = await loadClientLocations(rows.map(r => r.id));
    res.json(rows.map(r => serialize(r, locMap)));
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

const validateLocations = async (locationIds) => {
  const locIds = Array.isArray(locationIds) ? locationIds.filter(Boolean) : [];
  if (!locIds.length) return locIds;
  const ph = locIds.map(() => '?').join(',');
  const [locs] = await pool.query(`SELECT id FROM locations WHERE id IN (${ph})`, locIds);
  return locs.length === locIds.length ? locIds : null;
};

// Admin: create a client reference record
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { company, name, email, phone, address, notes } = req.body;
    const status = req.body.status === 'Inactive' ? 'Inactive' : 'Active';

    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const locIds = await validateLocations(req.body.locationIds);
    if (locIds === null) {
      return res.status(400).json({ error: 'One or more locations do not exist' });
    }

    await connection.beginTransaction();

    const clientId = generateClientId();
    await connection.query(
      'INSERT INTO clients (id, user_id, name, company, email, phone, address, status, notes) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)',
      [clientId, name || company, company, email || null, phone || null, address || null, status, notes || null]
    );

    for (const locId of locIds) {
      await connection.query(
        'INSERT INTO client_locations (client_id, location_id) VALUES (?, ?)',
        [clientId, locId]
      );
    }

    await connection.commit();
    await logActionFromReq(req, 'created_client', 'client', clientId, {
      company, email: email || null, status, locations: locIds,
    });
    res.status(201).json({ id: clientId, message: 'Client record created' });
  } catch (error) {
    await connection.rollback();
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client record' });
  } finally {
    connection.release();
  }
});

// Admin: update a client record (details + location links)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const prev = rows[0];

    const pick = (k) => (req.body[k] !== undefined ? req.body[k] : undefined);
    const status = pick('status') !== undefined
      ? (req.body.status === 'Inactive' ? 'Inactive' : 'Active')
      : (prev.status || 'Active');
    const merged = {
      name: pick('name') ?? prev.name,
      company: pick('company') ?? prev.company,
      email: pick('email') ?? prev.email,
      phone: pick('phone') ?? prev.phone,
      address: pick('address') ?? prev.address,
      status,
      notes: pick('notes') ?? prev.notes,
    };

    const locIds = req.body.locationIds === undefined
      ? null
      : await validateLocations(req.body.locationIds);
    if (req.body.locationIds !== undefined && locIds === null) {
      return res.status(400).json({ error: 'One or more locations do not exist' });
    }

    await connection.beginTransaction();
    await connection.query(
      'UPDATE clients SET name = ?, company = ?, email = ?, phone = ?, address = ?, status = ?, notes = ? WHERE id = ?',
      [merged.name, merged.company, merged.email, merged.phone, merged.address, merged.status, merged.notes, req.params.id]
    );

    if (locIds !== null) {
      await connection.query('DELETE FROM client_locations WHERE client_id = ?', [req.params.id]);
      for (const locId of locIds) {
        await connection.query('INSERT INTO client_locations (client_id, location_id) VALUES (?, ?)',
          [req.params.id, locId]);
      }
    }

    await connection.commit();
    const changes = {};
    for (const [label, col] of [['Company', 'company'], ['Name', 'name'], ['Email', 'email'], ['Phone', 'phone'], ['Address', 'address'], ['Status', 'status'], ['Notes', 'notes']]) {
      const before = prev[col] ?? null;
      const after = merged[col] ?? null;
      if (String(before) !== String(after)) changes[label] = { from: before ?? '—', to: after ?? '—' };
    }
    if (locIds !== null) changes['Locations'] = { from: 'updated', to: `${locIds.length} linked` };
    await logActionFromReq(req, 'updated_client', 'client', req.params.id, { company: merged.company, changes });
    res.json({ message: 'Client updated' });
  } catch (error) {
    await connection.rollback();
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Failed to update client' });
  } finally {
    connection.release();
  }
});

// Admin: delete a client record (also removes location links and any legacy login)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    await connection.beginTransaction();
    await connection.query('DELETE FROM client_locations WHERE client_id = ?', [req.params.id]);
    await connection.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    if (client.user_id != null) {
      await connection.query('DELETE FROM users WHERE id = ?', [client.user_id]);
    }
    await connection.commit();

    await logActionFromReq(req, 'deleted_client', 'client', req.params.id, {
      name: client.name, company: client.company, email: client.email,
    });
    res.json({ message: 'Client deleted' });
  } catch (error) {
    await connection.rollback();
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  } finally {
    connection.release();
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
