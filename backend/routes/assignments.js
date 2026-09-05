const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

const generateId = () => `ASG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const fmtD = (v) => v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10);

// Admin: create or update an assignment (unique per worker+date — update-in-place)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId, locationId, date } = req.body;
    if (!workerId || !locationId || !date) {
      return res.status(400).json({ error: 'workerId, locationId and date are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const [workers] = await pool.query('SELECT id, name, email, status FROM workers WHERE id = ?', [workerId]);
    if (workers.length === 0) return res.status(404).json({ error: 'Worker not found' });
    const [locs] = await pool.query('SELECT id, name, address FROM locations WHERE id = ?', [locationId]);
    if (locs.length === 0) return res.status(404).json({ error: 'Location not found' });

    const worker = workers[0];
    const loc = locs[0];
    const adminId = req.user.userId || null;

    // Duplicate handling: if the same worker already has an assignment for this
    // date, UPDATE it in place (returns updated:true) rather than erroring.
    const [existing] = await pool.query(
      'SELECT id FROM worker_location_assignments WHERE worker_id = ? AND assigned_date = ?',
      [workerId, date]
    );

    let id;
    let updated = false;
    if (existing.length > 0) {
      id = existing[0].id;
      updated = true;
      await pool.query(
        'UPDATE worker_location_assignments SET location_id = ?, created_by_admin_id = ? WHERE id = ?',
        [locationId, adminId, id]
      );
    } else {
      id = generateId();
      await pool.query(
        'INSERT INTO worker_location_assignments (id, worker_id, location_id, assigned_date, created_by_admin_id) VALUES (?, ?, ?, ?, ?)',
        [id, workerId, locationId, date, adminId]
      );
    }

    // Email the worker (falls back to console log if SMTP unavailable)
    const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const emailResult = await sendEmail({
      to: worker.email,
      subject: `Work assignment: ${loc.name} on ${prettyDate}`,
      html: `
        <h2>Daily Work Assignment</h2>
        <p>Hi ${worker.name},</p>
        <p>You are assigned to work at <strong>${loc.name}</strong> (${loc.address || ''}) on <strong>${prettyDate}</strong>.</p>
        <p>Please ensure you check in from this location.</p>
      `,
      text: `You are assigned to work at ${loc.name} (${loc.address || ''}) on ${prettyDate}. Please ensure you check in from this location.`
    });

    res.status(updated ? 200 : 201).json({
      id, workerId, locationId, date, updated,
      email: emailResult.method,
      message: updated ? 'Assignment updated' : 'Assignment created'
    });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: 'Failed to save assignment' });
  }
});

// Admin: list assignments for a date (defaults to today)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : new Date().toISOString().split('T')[0];
    const [rows] = await pool.query(
      `SELECT a.id, a.worker_id, w.name AS worker_name, a.location_id, l.name AS location_name,
              l.address AS location_address, a.assigned_date, a.created_at
       FROM worker_location_assignments a
       JOIN workers w ON w.id = a.worker_id
       JOIN locations l ON l.id = a.location_id
       WHERE a.assigned_date = ?
       ORDER BY w.name`,
      [date]
    );
    res.json(rows.map(r => ({
      id: r.id,
      workerId: r.worker_id,
      worker: r.worker_name,
      locationId: r.location_id,
      location: r.location_name,
      address: r.location_address,
      date: fmtD(r.assigned_date),
      createdAt: r.created_at,
    })));
  } catch (error) {
    console.error('List assignments error:', error);
    res.status(500).json({ error: 'Failed to load assignments' });
  }
});

// Admin: today's assignments with live check-in status
router.get('/today', requireAuth, requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [rows] = await pool.query(
      `SELECT a.id, a.worker_id, w.name AS worker_name, l.name AS location_name,
              att.check_in_time, att.location AS actual_location, att.location_mismatch,
              att.assignment_status
       FROM worker_location_assignments a
       JOIN workers w ON w.id = a.worker_id
       JOIN locations l ON l.id = a.location_id
       LEFT JOIN attendance att
         ON att.worker_id = a.worker_id AND att.date = a.assigned_date
       WHERE a.assigned_date = ?
       ORDER BY w.name`,
      [today]
    );
    res.json(rows.map(r => ({
      id: r.id,
      workerId: r.worker_id,
      worker: r.worker_name,
      location: r.location_name,
      status: !r.check_in_time ? 'not_checked_in'
        : r.assignment_status === 'mismatch' ? 'mismatch'
        : 'match',
      checkedInAt: r.check_in_time || null,
      actualLocation: r.actual_location || null,
    })));
  } catch (error) {
    console.error('Today assignments error:', error);
    res.status(500).json({ error: 'Failed to load today assignments' });
  }
});

// Admin: delete an assignment
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM worker_location_assignments WHERE id = ?', [req.params.id]);
    res.json({ message: 'Assignment deleted' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

module.exports = router;
