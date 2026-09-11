const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { logActionFromReq } = require('../utils/action-log');

const generateClientId = () => `CLT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

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
  userId: row.user_id,
  name: row.name,
  company: row.company,
  email: row.email,
  buyerName: row.buyer_name,
  locations: locMap[row.id] || [],
  createdAt: row.created_at,
});

// Admin: list all client accounts
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

// Admin: create a client account (users row + clients row + location links)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { name, company, email, password, buyerName, locationIds } = req.body;

    if (!name || !company || !email || !password) {
      return res.status(400).json({ error: 'name, company, email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const locIds = Array.isArray(locationIds) ? locationIds.filter(Boolean) : [];
    if (locIds.length) {
      const ph = locIds.map(() => '?').join(',');
      const [locs] = await pool.query(`SELECT id FROM locations WHERE id IN (${ph})`, locIds);
      if (locs.length !== locIds.length) {
        return res.status(400).json({ error: 'One or more locations do not exist' });
      }
    }

    await connection.beginTransaction();

    const passwordHash = await bcrypt.hash(String(password), 10);
    const [userResult] = await connection.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, "client")',
      [name, normalizedEmail, passwordHash]
    );

    const clientId = generateClientId();
    await connection.query(
      'INSERT INTO clients (id, user_id, name, company, email, buyer_name) VALUES (?, ?, ?, ?, ?, ?)',
      [clientId, userResult.insertId, name, company, normalizedEmail, buyerName || company]
    );

    for (const locId of locIds) {
      await connection.query(
        'INSERT INTO client_locations (client_id, location_id) VALUES (?, ?)',
        [clientId, locId]
      );
    }

    await connection.commit();

    // Welcome email — credentials are set by admin; the link is just the login page
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: 'Your WorkHR client portal account',
        html: `
          <h2>Welcome to the WorkHR Client Portal</h2>
          <p>Hi ${name},</p>
          <p>An account has been created for <strong>${company}</strong>. You can sign in with this email
          and the password provided by your WorkHR contact.</p>
          <p><a href="${process.env.FRONTEND_URL || 'http://localhost:8080'}">Open the client portal</a>
          and choose the <strong>Client</strong> tab.</p>
          <p>If you did not expect this, please ignore this email.</p>
        `,
        text: `A WorkHR client portal account was created for ${company}. Sign in with this email and the password provided by your WorkHR contact.`,
      });
    } catch (e) {
      console.error('Client welcome email failed:', e.message);
    }

    await logActionFromReq(req, 'created_client', 'client', clientId, {
      name, company, email: normalizedEmail, buyerName: buyerName || company, locations: locIds,
    });
    res.status(201).json({ id: clientId, message: 'Client account created' });
  } catch (error) {
    await connection.rollback();
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client account' });
  } finally {
    connection.release();
  }
});

// Admin: update a client (details, buyer link, location links)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { name, company, email, buyerName, locationIds } = req.body;

    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const prev = rows[0];

    const normalizedEmail = email ? String(email).trim().toLowerCase() : prev.email;
    if (normalizedEmail !== prev.email) {
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [normalizedEmail, prev.user_id]);
      if (dup.length > 0) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    }

    const locIds = locationIds === undefined ? null : (Array.isArray(locationIds) ? locationIds.filter(Boolean) : []);
    if (locIds && locIds.length) {
      const ph = locIds.map(() => '?').join(',');
      const [locs] = await pool.query(`SELECT id FROM locations WHERE id IN (${ph})`, locIds);
      if (locs.length !== locIds.length) {
        return res.status(400).json({ error: 'One or more locations do not exist' });
      }
    }

    await connection.beginTransaction();
    await connection.query(
      'UPDATE clients SET name = ?, company = ?, email = ?, buyer_name = ? WHERE id = ?',
      [name ?? prev.name, company ?? prev.company, normalizedEmail, buyerName ?? prev.buyer_name, req.params.id]
    );
    await connection.query('UPDATE users SET name = ?, email = ? WHERE id = ?',
      [name ?? prev.name, normalizedEmail, prev.user_id]);

    if (locIds !== null) {
      await connection.query('DELETE FROM client_locations WHERE client_id = ?', [req.params.id]);
      for (const locId of locIds) {
        await connection.query('INSERT INTO client_locations (client_id, location_id) VALUES (?, ?)',
          [req.params.id, locId]);
      }
    }

    await connection.commit();
    await logActionFromReq(req, 'updated_client', 'client', req.params.id, {
      before: { name: prev.name, company: prev.company, email: prev.email, buyerName: prev.buyer_name },
      after: { name: name ?? prev.name, company: company ?? prev.company, email: normalizedEmail, buyerName: buyerName ?? prev.buyer_name },
      ...(locIds !== null ? { locations: locIds } : {}),
    });
    res.json({ message: 'Client updated' });
  } catch (error) {
    await connection.rollback();
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Failed to update client' });
  } finally {
    connection.release();
  }
});

// Admin: reset a client's password directly
router.post('/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const [rows] = await pool.query('SELECT user_id, name FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, rows[0].user_id]);

    await logActionFromReq(req, 'reset_client_password', 'client', req.params.id, { name: rows[0].name });
    res.json({ message: 'Client password reset' });
  } catch (error) {
    console.error('Reset client password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Admin: delete a client account (also removes the users row)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = rows[0];

    await connection.beginTransaction();
    await connection.query('DELETE FROM client_locations WHERE client_id = ?', [req.params.id]);
    await connection.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    await connection.query('DELETE FROM users WHERE id = ?', [client.user_id]);
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

module.exports = router;
