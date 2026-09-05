const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Generate unique worker code
const generateWorkerCode = async () => {
  const year = new Date().getFullYear();
  const [workers] = await pool.query(
    'SELECT id FROM workers WHERE id LIKE ? ORDER BY id DESC LIMIT 1',
    [`WKR-${year}-%`]
  );
  
  let nextNum = 147;
  if (workers.length > 0) {
    const lastId = workers[0].id;
    const match = lastId.match(/WKR-\d{4}-(\d{4})/);
    if (match) {
      nextNum = parseInt(match[1]) + 1;
    }
  }
  return `WKR-${year}-${String(nextNum).padStart(4, '0')}`;
};

// Admin: Get all workers
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, location } = req.query;
    
    let query = 'SELECT * FROM workers';
    const params = [];
    
    if (status && status !== 'all') {
      if (status === 'Expiring Soon') {
        query += ' WHERE expiry <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND expiry >= CURDATE() AND status = "active"';
      } else if (status === 'Expired') {
        query += ' WHERE status = "expired"';
      } else if (status === 'On Leave') {
        query += ' WHERE on_leave = 1 AND status = "active"';
      } else if (status === 'Active') {
        query += ' WHERE status = "active" AND on_leave = 0';
      }
    }
    
    if (location && location !== 'all') {
      query += (status && status !== 'all') ? ' AND' : ' WHERE';
      query += ' location = ?';
      params.push(location);
    }
    
    query += ' ORDER BY joined DESC';
    
    const [workers] = await pool.query(query, params);

    // Compliance completion counts for the directory "X/8" column (Phase E)
    const [complianceCounts] = await pool.query(
      `SELECT worker_id, SUM(status = 'complete') AS done, COUNT(*) AS total
       FROM worker_compliance_checks GROUP BY worker_id`
    );
    const complianceByWorker = {};
    for (const c of complianceCounts) {
      complianceByWorker[c.worker_id] = { done: Number(c.done), total: Number(c.total) };
    }

    // Normalize database field names to match frontend expectations
    const normalizedWorkers = workers.map(w => ({
      ...w,
      onLeave: w.on_leave === 1,
      passportCountry: w.passport_country,
      passportNumber: w.passport_number,
      passportExpiry: w.passport_expiry,
      visaNumber: w.visa_number,
      visaExpiry: w.visa_expiry,
      siaBadgeNumber: w.sia_badge_number,
      siaBadgeExpiry: w.sia_badge_expiry,
      workerType: w.worker_type || 'Direct',
      subcontractCompany: w.subcontract_company,
      complianceDone: complianceByWorker[w.id]?.done || 0
    }));
    
    res.json(normalizedWorkers);
  } catch (error) {
    console.error('Get workers error:', error);
    res.status(500).json({ error: true, message: 'Failed to load workers' });
  }
});

// Admin: Get single worker
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [workers] = await pool.query(
      'SELECT * FROM workers WHERE id = ?',
      [req.params.id]
    );

    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Get related data
    const [prevAddresses] = await pool.query(
      'SELECT * FROM worker_previous_addresses WHERE worker_id = ?',
      [req.params.id]
    );
    
    const [employmentHistory] = await pool.query(
      'SELECT * FROM worker_employment_history WHERE worker_id = ?',
      [req.params.id]
    );
    
    const [referees] = await pool.query(
      'SELECT * FROM worker_referees WHERE worker_id = ?',
      [req.params.id]
    );
    
    const [qualifications] = await pool.query(
      'SELECT * FROM worker_qualifications WHERE worker_id = ?',
      [req.params.id]
    );

    // Normalize database field names to match frontend expectations
    const w = workers[0];
    const normalizedWorker = {
      ...w,
      onLeave: w.on_leave === 1,
      passportCountry: w.passport_country,
      passportNumber: w.passport_number,
      passportExpiry: w.passport_expiry,
      visaNumber: w.visa_number,
      visaExpiry: w.visa_expiry,
      siaBadgeNumber: w.sia_badge_number,
      siaBadgeExpiry: w.sia_badge_expiry,
      workerType: w.worker_type || 'Direct',
      subcontractCompany: w.subcontract_company
    };

    res.json({
      ...normalizedWorker,
      prevAddresses,
      employmentHistory,
      referees,
      qualifications
    });
  } catch (error) {
    console.error('Get worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Create worker
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, phone, email, location, role, rate, address, nid } = req.body;
    
    const workerId = await generateWorkerCode();
    const joined = new Date();
    const expiry = new Date(joined);
    expiry.setMonth(expiry.getMonth() + 3);

    await pool.query(
      `INSERT INTO workers 
      (id, name, phone, email, location, role, rate, joined, expiry, address, nid, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [workerId, name, phone, email, location, role, rate, joined, expiry, address, nid]
    );

    res.status(201).json({ id: workerId, message: 'Worker created successfully' });
  } catch (error) {
    console.error('Create worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update worker
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, phone, email, location, role, rate, address, nid, on_leave } = req.body;
    
    await pool.query(
      `UPDATE workers 
      SET name = ?, phone = ?, email = ?, location = ?, role = ?, rate = ?, 
          address = ?, nid = ?, on_leave = ? 
      WHERE id = ?`,
      [name, phone, email, location, role, rate, address, nid, on_leave, req.params.id]
    );

    res.json({ message: 'Worker updated successfully' });
  } catch (error) {
    console.error('Update worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Reactivate worker
router.post('/:id/reactivate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const joined = new Date();
    const expiry = new Date(joined);
    expiry.setMonth(expiry.getMonth() + 3);

    await pool.query(
      'UPDATE workers SET joined = ?, expiry = ?, on_leave = false, status = "active" WHERE id = ?',
      [joined, expiry, req.params.id]
    );

    // Log notification
    const [workers] = await pool.query('SELECT name FROM workers WHERE id = ?', [req.params.id]);
    if (workers.length > 0) {
      await pool.query(
        'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "info", "Just now")',
        [`N-${Date.now()}`, workers[0].name, req.params.id, 'Contract reactivated for another 3 months']
      );
    }

    res.json({ message: 'Worker reactivated successfully' });
  } catch (error) {
    console.error('Reactivate worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete worker
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM workers WHERE id = ?', [req.params.id]);
    res.json({ message: 'Worker deleted successfully' });
  } catch (error) {
    console.error('Delete worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Reset worker password
router.post('/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    await pool.query(
      'UPDATE workers SET password_hash = ? WHERE id = ?',
      [passwordHash, req.params.id]
    );
    
    res.json({ message: 'Worker password reset successfully' });
  } catch (error) {
    console.error('Reset worker password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ---------------- BS7858 compliance checklist (Phase E, admin-only) ---------------- */

// The 8 BS7858 screening items. `level` is only used by criminalRecords.
const COMPLIANCE_KEYS = [
  'electronicId',
  'addressHistory',
  'financialChecks',
  'rightToWork',
  'employmentHistory5y',
  'gapPeriods',
  'academicQualifications',
  'criminalRecords',
];
const COMPLIANCE_STATUSES = ['not_started', 'in_progress', 'complete'];
const CRIMINAL_LEVELS = ['Basic', 'Standard', 'Enhanced'];

// Admin: Get a worker's compliance checklist (fills defaults for missing rows)
router.get('/:id/compliance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [workers] = await pool.query('SELECT id FROM workers WHERE id = ?', [req.params.id]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const [rows] = await pool.query(
      'SELECT check_key, status, completed_date, notes, level FROM worker_compliance_checks WHERE worker_id = ?',
      [req.params.id]
    );
    const byKey = {};
    for (const r of rows) byKey[r.check_key] = r;

    const checks = COMPLIANCE_KEYS.map((key) => {
      const r = byKey[key];
      return {
        key,
        status: r ? r.status : 'not_started',
        completedDate: r && r.completed_date
          ? (r.completed_date instanceof Date
              ? `${r.completed_date.getFullYear()}-${String(r.completed_date.getMonth() + 1).padStart(2, '0')}-${String(r.completed_date.getDate()).padStart(2, '0')}`
              : String(r.completed_date).slice(0, 10))
          : null,
        notes: r ? (r.notes || '') : '',
        level: r ? (r.level || '') : '',
      };
    });

    res.json({
      workerId: req.params.id,
      checks,
      complete: checks.filter((c) => c.status === 'complete').length,
      total: COMPLIANCE_KEYS.length,
    });
  } catch (error) {
    console.error('Get compliance error:', error);
    res.status(500).json({ error: 'Failed to load compliance checklist' });
  }
});

// Admin: Save a worker's compliance checklist (upsert each item)
router.put('/:id/compliance', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [workers] = await connection.query('SELECT id FROM workers WHERE id = ?', [req.params.id]);
    if (workers.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Worker not found' });
    }

    const incoming = Array.isArray(req.body?.checks) ? req.body.checks : [];
    for (const item of incoming) {
      if (!COMPLIANCE_KEYS.includes(item.key)) continue;
      const status = COMPLIANCE_STATUSES.includes(item.status) ? item.status : 'not_started';
      const completedDate = item.completedDate && /^\d{4}-\d{2}-\d{2}$/.test(item.completedDate)
        ? item.completedDate : null;
      const notes = item.notes ? String(item.notes) : null;
      const level = item.key === 'criminalRecords' && CRIMINAL_LEVELS.includes(item.level)
        ? item.level : null;
      await connection.query(
        `INSERT INTO worker_compliance_checks (worker_id, check_key, status, completed_date, notes, level)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), completed_date = VALUES(completed_date),
           notes = VALUES(notes), level = VALUES(level)`,
        [req.params.id, item.key, status, completedDate, notes, level]
      );
    }

    await connection.commit();

    // Return the saved checklist
    const [rows] = await pool.query(
      'SELECT check_key, status, completed_date, notes, level FROM worker_compliance_checks WHERE worker_id = ?',
      [req.params.id]
    );
    const byKey = {};
    for (const r of rows) byKey[r.check_key] = r;
    const checks = COMPLIANCE_KEYS.map((key) => {
      const r = byKey[key];
      return {
        key,
        status: r ? r.status : 'not_started',
        completedDate: r && r.completed_date
          ? (r.completed_date instanceof Date
              ? `${r.completed_date.getFullYear()}-${String(r.completed_date.getMonth() + 1).padStart(2, '0')}-${String(r.completed_date.getDate()).padStart(2, '0')}`
              : String(r.completed_date).slice(0, 10))
          : null,
        notes: r ? (r.notes || '') : '',
        level: r ? (r.level || '') : '',
      };
    });

    res.json({
      workerId: req.params.id,
      checks,
      complete: checks.filter((c) => c.status === 'complete').length,
      total: COMPLIANCE_KEYS.length,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Save compliance error:', error);
    res.status(500).json({ error: 'Failed to save compliance checklist' });
  } finally {
    connection.release();
  }
});

module.exports = router;
