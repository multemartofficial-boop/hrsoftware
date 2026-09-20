const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { appBaseUrl } = require('../utils/app-url');
const { logActionFromReq } = require('../utils/action-log');

const generateClientId = () => `CLT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Clients hold company details plus which locations belong to them. When a
// password is supplied the client also gets a portal login (users row, role
// 'client') — leave it blank for an internal reference record only.
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

// Workers "under" a client = workers whose base location is one of the
// client's linked locations, or who have any assignment at them.
const loadClientWorkerCounts = async (clientIds) => {
  if (!clientIds.length) return {};
  const ph = clientIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT client_id, COUNT(DISTINCT worker_id) AS count FROM (
       SELECT cl.client_id, w.id AS worker_id
       FROM client_locations cl
       JOIN locations l ON l.id = cl.location_id
       JOIN workers w ON w.location = l.name
       UNION
       SELECT cl.client_id, a.worker_id
       FROM client_locations cl
       JOIN worker_location_assignments a ON a.location_id = cl.location_id
     ) t WHERE client_id IN (${ph}) GROUP BY client_id`,
    clientIds
  );
  const map = {};
  for (const r of rows) map[r.client_id] = Number(r.count);
  return map;
};

const serialize = (row, locMap, workerCounts) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  company: row.company,
  email: row.email,
  phone: row.phone,
  address: row.address,
  status: row.status || 'Active',
  notes: row.notes,
  buyerName: row.buyer_name ?? null,
  locations: locMap[row.id] || [],
  workerCount: workerCounts[row.id] || 0,
  createdAt: row.created_at,
});

// Provision (or reset) the portal login for a client record. Returns the
// users.id linked to the client.
const provisionLogin = async (connection, { userId, name, email, password }) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(String(password), 10);
  if (userId) {
    await connection.query(
      'UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?',
      [name, normalizedEmail, passwordHash, userId]
    );
    return userId;
  }
  const [result] = await connection.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, "client")',
    [name, normalizedEmail, passwordHash]
  );
  return result.insertId;
};

const sendWelcomeEmail = async (req, { name, company, email }) => {
  try {
    await sendEmail({
      to: email,
      subject: 'Your WorkHR client portal account',
      html: `
        <h2>Welcome to the WorkHR Client Portal</h2>
        <p>Hi ${name},</p>
        <p>An account has been created for <strong>${company}</strong>. You can sign in with this email
        and the password provided by your WorkHR contact.</p>
        <p><a href="${appBaseUrl(req)}">Open the client portal</a>
        and choose the <strong>Client</strong> tab.</p>
        <p>If you did not expect this, please ignore this email.</p>
      `,
      text: `A WorkHR client portal account was created for ${company}. Sign in with this email and the password provided by your WorkHR contact.`,
    });
  } catch (e) {
    console.error('Client welcome email failed:', e.message);
  }
};

// Admin: list all client records
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    const locMap = await loadClientLocations(rows.map(r => r.id));
    const workerCounts = await loadClientWorkerCounts(rows.map(r => r.id));
    res.json(rows.map(r => serialize(r, locMap, workerCounts)));
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

// Admin: create a client record (+ optional portal login when password given)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { company, name, email, phone, address, notes, password, buyerName } = req.body;
    const status = req.body.status === 'Inactive' ? 'Inactive' : 'Active';

    if (!company || !String(company).trim()) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const wantsLogin = Boolean(password && String(password).length);
    if (wantsLogin) {
      if (!email || !String(email).trim()) {
        return res.status(400).json({ error: 'Email is required to create a portal login' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    }

    const locIds = await validateLocations(req.body.locationIds);
    if (locIds === null) {
      return res.status(400).json({ error: 'One or more locations do not exist' });
    }

    await connection.beginTransaction();

    const clientId = generateClientId();
    let userId = null;
    if (wantsLogin) {
      userId = await provisionLogin(connection, {
        userId: null,
        name: name || company,
        email,
        password,
      });
    }

    await connection.query(
      'INSERT INTO clients (id, user_id, name, company, email, phone, address, status, notes, buyer_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [clientId, userId, name || company, company, email || null, phone || null, address || null, status, notes || null, buyerName || null]
    );

    for (const locId of locIds) {
      await connection.query(
        'INSERT INTO client_locations (client_id, location_id) VALUES (?, ?)',
        [clientId, locId]
      );
    }

    await connection.commit();

    if (wantsLogin) {
      await sendWelcomeEmail(req, { name: name || company, company, email: String(email).trim().toLowerCase() });
    }

    await logActionFromReq(req, 'created_client', 'client', clientId, {
      company, email: email || null, status, locations: locIds, portalLogin: wantsLogin,
    });
    res.status(201).json({ id: clientId, portalLogin: wantsLogin, message: 'Client record created' });
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
      buyer_name: pick('buyerName') !== undefined ? (req.body.buyerName || null) : prev.buyer_name,
    };

    // Portal password: provided → create or reset the login.
    const newPassword = pick('password');
    if (newPassword !== undefined && newPassword !== '') {
      if (String(newPassword).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      if (!merged.email || !String(merged.email).trim()) {
        return res.status(400).json({ error: 'Email is required to create a portal login' });
      }
    }
    // Keep the login email unique when a login exists or will be created.
    if ((prev.user_id || (newPassword && newPassword !== '')) && merged.email) {
      const normalizedEmail = String(merged.email).trim().toLowerCase();
      const [dup] = await pool.query(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [normalizedEmail, prev.user_id ?? -1]
      );
      if (dup.length > 0) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    }

    const locIds = req.body.locationIds === undefined
      ? null
      : await validateLocations(req.body.locationIds);
    if (req.body.locationIds !== undefined && locIds === null) {
      return res.status(400).json({ error: 'One or more locations do not exist' });
    }

    await connection.beginTransaction();

    let userId = prev.user_id;
    if (newPassword !== undefined && newPassword !== '') {
      userId = await provisionLogin(connection, {
        userId: prev.user_id,
        name: merged.name,
        email: merged.email,
        password: newPassword,
      });
    } else if (prev.user_id) {
      // Login exists — keep its name/email in sync with the record.
      await connection.query(
        'UPDATE users SET name = ?, email = ? WHERE id = ?',
        [merged.name, String(merged.email).trim().toLowerCase(), prev.user_id]
      );
    }

    await connection.query(
      'UPDATE clients SET user_id = ?, name = ?, company = ?, email = ?, phone = ?, address = ?, status = ?, notes = ?, buyer_name = ? WHERE id = ?',
      [userId, merged.name, merged.company, merged.email, merged.phone, merged.address, merged.status, merged.notes, merged.buyer_name, req.params.id]
    );

    if (locIds !== null) {
      await connection.query('DELETE FROM client_locations WHERE client_id = ?', [req.params.id]);
      for (const locId of locIds) {
        await connection.query('INSERT INTO client_locations (client_id, location_id) VALUES (?, ?)',
          [req.params.id, locId]);
      }
    }

    await connection.commit();

    // Welcome email only when a login was newly created (not on password resets)
    if (!prev.user_id && userId) {
      await sendWelcomeEmail(req, { name: merged.name, company: merged.company, email: String(merged.email).trim().toLowerCase() });
    }

    const changes = {};
    for (const [label, col] of [['Company', 'company'], ['Name', 'name'], ['Email', 'email'], ['Phone', 'phone'], ['Address', 'address'], ['Status', 'status'], ['Notes', 'notes']]) {
      const before = prev[col] ?? null;
      const after = merged[col] ?? null;
      if (String(before) !== String(after)) changes[label] = { from: before ?? '—', to: after ?? '—' };
    }
    if (locIds !== null) changes['Locations'] = { from: 'updated', to: `${locIds.length} linked` };
    if (!prev.user_id && userId) changes['Portal login'] = { from: 'none', to: 'created' };
    else if (newPassword) changes['Portal login'] = { from: 'password', to: 'reset' };
    await logActionFromReq(req, 'updated_client', 'client', req.params.id, { company: merged.company, changes });
    res.json({ message: 'Client updated', portalLogin: userId != null });
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
