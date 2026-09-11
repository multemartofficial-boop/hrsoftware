const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireClient } = require('../middleware/auth');

// Load the client record + linked location ids for the signed-in client.
// Every portal endpoint is scoped strictly to this client's own data.
const loadClientScope = async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.user.clientId]);
  if (rows.length === 0) {
    res.status(404).json({ error: 'Client account not found' });
    return null;
  }
  const client = rows[0];
  const [locRows] = await pool.query(
    `SELECT l.id, l.name, l.address
     FROM client_locations cl JOIN locations l ON l.id = cl.location_id
     WHERE cl.client_id = ? ORDER BY l.name`,
    [client.id]
  );
  return { client, locations: locRows };
};

// GET /api/client/me — profile + linked locations
router.get('/me', requireAuth, requireClient, async (req, res) => {
  try {
    const scope = await loadClientScope(req, res);
    if (!scope) return;
    const { client, locations } = scope;
    res.json({
      id: client.id,
      name: client.name,
      company: client.company,
      email: client.email,
      locations,
    });
  } catch (error) {
    console.error('Client me error:', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// GET /api/client/overview — today's coverage at the client's sites
router.get('/overview', requireAuth, requireClient, async (req, res) => {
  try {
    const scope = await loadClientScope(req, res);
    if (!scope) return;
    const { client, locations } = scope;
    const locIds = locations.map(l => l.id);
    const locNames = locations.map(l => l.name);
    const today = new Date().toISOString().split('T')[0];

    let scheduledToday = 0;
    let checkedInNow = [];
    let todayRows = [];

    if (locIds.length) {
      const ph = locIds.map(() => '?').join(',');
      const [assignments] = await pool.query(
        `SELECT a.worker_id, w.name AS worker, l.name AS location
         FROM worker_location_assignments a
         JOIN workers w ON w.id = a.worker_id
         JOIN locations l ON l.id = a.location_id
         WHERE a.location_id IN (${ph}) AND a.assigned_date = ?
         ORDER BY w.name`,
        [...locIds, today]
      );
      scheduledToday = assignments.length;
      todayRows = assignments;

      // Workers currently on-site = open attendance today at any of the client's
      // location names (attendance stores the location NAME, matched at check-in).
      if (locNames.length) {
        const phN = locNames.map(() => '?').join(',');
        const [open] = await pool.query(
          `SELECT worker, location, check_in_time FROM attendance
           WHERE date = ? AND check_out_time IS NULL AND location IN (${phN})
           ORDER BY check_in_time`,
          [today, ...locNames]
        );
        checkedInNow = open;
      }
    }

    res.json({
      company: client.company,
      locations,
      scheduledToday: scheduledToday,
      scheduledWorkers: todayRows,
      checkedInNow,
      checkedInCount: checkedInNow.length,
    });
  } catch (error) {
    console.error('Client overview error:', error);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// GET /api/client/schedule?from&to — assignments at the client's locations.
// Read-only; workers are identified by name only (no personal/contact data).
router.get('/schedule', requireAuth, requireClient, async (req, res) => {
  try {
    const scope = await loadClientScope(req, res);
    if (!scope) return;
    const { locations } = scope;
    const locIds = locations.map(l => l.id);
    if (!locIds.length) return res.json([]);

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayD = new Date();
    const defaultTo = new Date(); defaultTo.setDate(defaultTo.getDate() + 14);

    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : fmt(todayD);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : fmt(defaultTo);
    if (to < from) return res.status(400).json({ error: '`to` must be on or after `from`' });

    // Cap the range at 62 days so a client can't pull the whole rota at once
    const spanDays = (new Date(to) - new Date(from)) / 86400000;
    if (spanDays > 62) return res.status(400).json({ error: 'Date range too wide (max 62 days)' });

    const ph = locIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT a.id, a.assigned_date, w.name AS worker, l.name AS location,
              att.check_in_time, att.check_out_time, att.assignment_status
       FROM worker_location_assignments a
       JOIN workers w ON w.id = a.worker_id
       JOIN locations l ON l.id = a.location_id
       LEFT JOIN attendance att
         ON att.worker_id = a.worker_id AND att.date = a.assigned_date
       WHERE a.location_id IN (${ph}) AND a.assigned_date BETWEEN ? AND ?
       ORDER BY a.assigned_date, w.name`,
      [...locIds, from, to]
    );

    res.json(rows.map(r => ({
      id: r.id,
      date: r.assigned_date instanceof Date ? fmt(r.assigned_date) : String(r.assigned_date).slice(0, 10),
      worker: r.worker,
      location: r.location,
      checkIn: r.check_in_time ? String(r.check_in_time).slice(0, 5) : null,
      checkOut: r.check_out_time ? String(r.check_out_time).slice(0, 5) : null,
      status: !r.check_in_time ? 'scheduled'
        : r.assignment_status === 'mismatch' ? 'checked_in_elsewhere'
        : r.check_out_time ? 'completed' : 'on_site',
    })));
  } catch (error) {
    console.error('Client schedule error:', error);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// GET /api/client/billing — buyer_income rows linked to this client's buyer name.
// Never exposes other buyers or any cost/profit internals.
router.get('/billing', requireAuth, requireClient, async (req, res) => {
  try {
    const scope = await loadClientScope(req, res);
    if (!scope) return;
    const { client } = scope;

    if (!client.buyer_name) return res.json({ buyerName: null, entries: [], totals: { received: 0, pending: 0 } });

    const [rows] = await pool.query(
      'SELECT id, description, amount, date, status FROM buyer_income WHERE buyer_name = ? ORDER BY date DESC',
      [client.buyer_name]
    );

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entries = rows.map(r => ({
      id: r.id,
      description: r.description,
      amount: Number(r.amount),
      date: r.date instanceof Date ? fmt(r.date) : String(r.date).slice(0, 10),
      status: r.status,
    }));

    res.json({
      buyerName: client.buyer_name,
      entries,
      totals: {
        received: entries.filter(e => e.status === 'Received').reduce((s, e) => s + e.amount, 0),
        pending: entries.filter(e => e.status === 'Pending').reduce((s, e) => s + e.amount, 0),
      },
    });
  } catch (error) {
    console.error('Client billing error:', error);
    res.status(500).json({ error: 'Failed to load billing' });
  }
});

module.exports = router;
