const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { logActionFromReq } = require('../utils/action-log');

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

    await logActionFromReq(req, updated ? 'updated_assignment' : 'assigned_worker', 'assignment', id, {
      workerId, worker: worker.name, location: loc.name, date,
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

/* ---------------- Bulk + recurring assignment (Phase 3) ---------------- */

// Every occurrence of `weekday` (0=Sun … 6=Sat) within [from, to], inclusive.
const weeklyDates = (from, to, weekday) => {
  const dates = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  // Advance to the first matching weekday
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  while (d <= end) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 7);
  }
  return dates;
};

const prettyDay = (iso) => new Date(iso + 'T00:00:00')
  .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Admin: assign MANY workers to one location for one date, optionally repeating
// weekly on a chosen weekday until an end date. Each (worker, date) pair upserts
// exactly like the single-assignment endpoint. One action-log entry covers the
// whole batch; each worker gets one email listing all their dates.
router.post('/bulk', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerIds, locationId, date, repeatWeekday, repeatUntil } = req.body;

    if (!Array.isArray(workerIds) || workerIds.length === 0) {
      return res.status(400).json({ error: 'workerIds must be a non-empty array' });
    }
    if (!locationId || !date) {
      return res.status(400).json({ error: 'locationId and date are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    // Build the date list — single date, or weekly recurrence on `repeatWeekday`
    // (defaults to the start date's own weekday) until `repeatUntil`.
    let dates = [date];
    if (repeatUntil) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(repeatUntil)) {
        return res.status(400).json({ error: 'repeatUntil must be YYYY-MM-DD' });
      }
      if (repeatUntil < date) {
        return res.status(400).json({ error: 'repeatUntil must be on or after the start date' });
      }
      const wd = repeatWeekday === undefined || repeatWeekday === null || repeatWeekday === ''
        ? new Date(date + 'T00:00:00').getDay()
        : Number(repeatWeekday);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
        return res.status(400).json({ error: 'repeatWeekday must be 0 (Sun) to 6 (Sat)' });
      }
      dates = weeklyDates(date, repeatUntil, wd);
      // Always include the start date itself even if it isn't the repeat weekday
      if (!dates.includes(date)) dates.unshift(date);
      if (dates.length > 60) {
        return res.status(400).json({ error: 'Recurrence would create over 60 dates per worker — shorten the range' });
      }
    }

    const [locs] = await pool.query('SELECT id, name, address FROM locations WHERE id = ?', [locationId]);
    if (locs.length === 0) return res.status(404).json({ error: 'Location not found' });
    const loc = locs[0];

    const placeholders = workerIds.map(() => '?').join(',');
    const [workers] = await pool.query(
      `SELECT id, name, email FROM workers WHERE id IN (${placeholders})`,
      workerIds
    );
    const found = new Set(workers.map(w => w.id));
    const missing = workerIds.filter(id => !found.has(id));
    if (workers.length === 0) {
      return res.status(404).json({ error: 'None of the selected workers exist' });
    }

    const adminId = req.user.userId || null;
    let created = 0, updated = 0;

    for (const worker of workers) {
      for (const d of dates) {
        const [existing] = await pool.query(
          'SELECT id FROM worker_location_assignments WHERE worker_id = ? AND assigned_date = ?',
          [worker.id, d]
        );
        if (existing.length > 0) {
          updated++;
          await pool.query(
            'UPDATE worker_location_assignments SET location_id = ?, created_by_admin_id = ? WHERE id = ?',
            [locationId, adminId, existing[0].id]
          );
        } else {
          created++;
          await pool.query(
            'INSERT INTO worker_location_assignments (id, worker_id, location_id, assigned_date, created_by_admin_id) VALUES (?, ?, ?, ?, ?)',
            [generateId(), worker.id, locationId, d, adminId]
          );
        }
      }

      // One email per worker listing every assigned date
      const dateList = dates.map(prettyDay).join(', ');
      try {
        await sendEmail({
          to: worker.email,
          subject: `Work assignment: ${loc.name} — ${dates.length} date${dates.length === 1 ? '' : 's'}`,
          html: `
            <h2>Work Assignment${dates.length === 1 ? '' : 's'}</h2>
            <p>Hi ${worker.name},</p>
            <p>You are assigned to work at <strong>${loc.name}</strong> (${loc.address || ''}) on:</p>
            <ul>${dates.map(d => `<li><strong>${prettyDay(d)}</strong></li>`).join('')}</ul>
            <p>Please ensure you check in from this location.</p>
          `,
          text: `You are assigned to work at ${loc.name} (${loc.address || ''}) on: ${dateList}. Please ensure you check in from this location.`
        });
      } catch (e) {
        console.error(`Bulk assignment email to ${worker.email} failed:`, e.message);
      }
    }

    // Single audit entry for the whole batch — keeps the action log readable
    await logActionFromReq(req, 'bulk_assigned_workers', 'location', locationId, {
      location: loc.name,
      workerIds: workers.map(w => w.id),
      workers: workers.map(w => w.name),
      dates,
      created,
      updated,
      ...(missing.length ? { skippedUnknownWorkers: missing } : {}),
    });

    res.status(201).json({
      location: loc.name,
      dates,
      workers: workers.map(w => ({ id: w.id, name: w.name })),
      created,
      updated,
      skipped: missing,
      message: `Assigned ${workers.length} worker${workers.length === 1 ? '' : 's'} to ${loc.name} across ${dates.length} date${dates.length === 1 ? '' : 's'} (${created} new, ${updated} updated)`,
    });
  } catch (error) {
    console.error('Bulk assignment error:', error);
    res.status(500).json({ error: 'Failed to create bulk assignment' });
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
    const [rows] = await pool.query(
      `SELECT a.worker_id, w.name AS worker_name, a.location_id, l.name AS location_name, a.assigned_date
       FROM worker_location_assignments a
       LEFT JOIN workers w ON w.id = a.worker_id
       LEFT JOIN locations l ON l.id = a.location_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    await pool.query('DELETE FROM worker_location_assignments WHERE id = ?', [req.params.id]);
    await logActionFromReq(req, 'deleted_assignment', 'assignment', req.params.id, {
      workerId: rows[0]?.worker_id, worker: rows[0]?.worker_name,
      location: rows[0]?.location_name, date: rows[0] ? fmtD(rows[0].assigned_date) : undefined,
    });
    res.json({ message: 'Assignment deleted' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

module.exports = router;
