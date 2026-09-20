const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { requireAuth, requireAdmin, requireWorker } = require('../middleware/auth');
const { logActionFromReq } = require('../utils/action-log');

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
      payType: w.pay_type === 'salary' ? 'salary' : 'hourly',
      monthlySalary: w.monthly_salary != null ? Number(w.monthly_salary) : null,
      complianceDone: complianceByWorker[w.id]?.done || 0
    }));
    
    res.json(normalizedWorkers);
  } catch (error) {
    console.error('Get workers error:', error);
    res.status(500).json({ error: true, message: 'Failed to load workers' });
  }
});

// Worker: own profile (must be registered before /:id so 'me' isn't treated as an id)
router.get('/me', requireAuth, requireWorker, async (req, res) => {
  try {
    const [workers] = await pool.query('SELECT * FROM workers WHERE id = ?', [req.user.workerId]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const w = workers[0];
    res.json({
      id: w.id,
      name: w.name,
      email: w.email,
      phone: w.phone,
      location: w.location,
      role: w.role,
      rate: Number(w.rate),
      payType: w.pay_type === 'salary' ? 'salary' : 'hourly',
      monthlySalary: w.monthly_salary != null ? Number(w.monthly_salary) : null,
      joined: w.joined,
      expiry: w.expiry,
      visaExpiry: w.visa_expiry,
      workerType: w.worker_type || 'Direct',
      subcontractCompany: w.subcontract_company,
      status: w.status,
      onLeave: w.on_leave === 1,
    });
  } catch (error) {
    console.error('Get my profile error:', error);
    res.status(500).json({ error: 'Failed to load profile' });
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
      subcontractCompany: w.subcontract_company,
      payType: w.pay_type === 'salary' ? 'salary' : 'hourly',
      monthlySalary: w.monthly_salary != null ? Number(w.monthly_salary) : null
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

    // Pay type (Part 2): 'hourly' keeps existing behaviour; 'salary' requires a
    // monthly salary amount instead of an hourly rate.
    const payType = (req.body.payType || req.body.pay_type) === 'salary' ? 'salary' : 'hourly';
    const salaryRaw = req.body.monthlySalary ?? req.body.monthly_salary;
    const monthlySalary = salaryRaw !== undefined && salaryRaw !== null && salaryRaw !== ''
      ? Number(salaryRaw) : null;
    if (payType === 'salary' && !(monthlySalary > 0)) {
      return res.status(400).json({ error: 'A monthly salary greater than 0 is required for salaried workers' });
    }
    const rateValue = payType === 'salary' ? 0 : (Number(rate) || 0);

    const workerId = await generateWorkerCode();
    const joined = new Date();
    const expiry = new Date(joined);
    expiry.setMonth(expiry.getMonth() + 3);

    await pool.query(
      `INSERT INTO workers
      (id, name, phone, email, location, role, rate, pay_type, monthly_salary, joined, expiry, address, nid, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [workerId, name, phone, email, location, role, rateValue, payType, monthlySalary, joined, expiry, address, nid]
    );

    await logActionFromReq(req, 'created_worker', 'worker', workerId, { name, email, location, role, rate: rateValue, payType, monthlySalary });
    res.status(201).json({ id: workerId, message: 'Worker created successfully' });
  } catch (error) {
    console.error('Create worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update worker. Fields not present in the body keep their current
// values — partial updates (e.g. just pay type) must not blank other columns,
// and mysql2 rejects undefined bind parameters. Every changed field is logged
// to Action History with its before/after value.
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM workers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const cur = rows[0];

    // First matching key wins; undefined means "not sent — keep current value".
    const pick = (...keys) => {
      for (const k of keys) {
        if (req.body[k] !== undefined) return req.body[k];
      }
      return undefined;
    };
    // Nullable column merge: undefined keeps the current value, ''/null clears to NULL.
    const keep = (v, curVal) => (v === undefined ? curVal : v);
    const dateStr = (v) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
      }
      return String(v).slice(0, 10);
    };

    const payTypeRaw = pick('payType', 'pay_type');
    const payType = payTypeRaw !== undefined
      ? (payTypeRaw === 'salary' ? 'salary' : 'hourly')
      : (cur.pay_type === 'salary' ? 'salary' : 'hourly');
    const salaryRaw = pick('monthlySalary', 'monthly_salary');
    const monthlySalary = salaryRaw !== undefined
      ? (salaryRaw === null || salaryRaw === '' ? null : Number(salaryRaw))
      : (cur.monthly_salary != null ? Number(cur.monthly_salary) : null);
    if (payType === 'salary' && !(monthlySalary > 0)) {
      return res.status(400).json({ error: 'A monthly salary greater than 0 is required for salaried workers' });
    }

    const onLeaveRaw = pick('on_leave', 'onLeave');
    const merged = {
      name: keep(pick('name'), cur.name),
      phone: keep(pick('phone'), cur.phone),
      email: keep(pick('email'), cur.email),
      location: keep(pick('location'), cur.location),
      role: keep(pick('role'), cur.role),
      rate: payType === 'salary' ? 0 : (pick('rate') !== undefined ? Number(pick('rate')) : Number(cur.rate) || 0),
      pay_type: payType,
      monthly_salary: monthlySalary,
      address: keep(pick('address'), cur.address),
      nid: keep(pick('nid'), cur.nid),
      on_leave: onLeaveRaw !== undefined
        ? (onLeaveRaw === true || onLeaveRaw === 1 || onLeaveRaw === '1')
        : (cur.on_leave === 1),
      joined: keep(dateStr(pick('joined')), dateStr(cur.joined)),
      expiry: keep(dateStr(pick('expiry')), dateStr(cur.expiry)),
      passport_country: keep(pick('passportCountry', 'passport_country'), cur.passport_country),
      passport_number: keep(pick('passportNumber', 'passport_number'), cur.passport_number),
      passport_expiry: keep(dateStr(pick('passportExpiry', 'passport_expiry')), dateStr(cur.passport_expiry)),
      visa_number: keep(pick('visaNumber', 'visa_number'), cur.visa_number),
      visa_expiry: keep(dateStr(pick('visaExpiry', 'visa_expiry')), dateStr(cur.visa_expiry)),
      sia_badge_number: keep(pick('siaBadgeNumber', 'sia_badge_number'), cur.sia_badge_number),
      sia_badge_expiry: keep(dateStr(pick('siaBadgeExpiry', 'sia_badge_expiry')), dateStr(cur.sia_badge_expiry)),
      worker_type: keep(pick('workerType', 'worker_type'), cur.worker_type),
      subcontract_company: keep(pick('subcontractCompany', 'subcontract_company'), cur.subcontract_company),
    };

    await pool.query(
      `UPDATE workers
      SET name = ?, phone = ?, email = ?, location = ?, role = ?, rate = ?,
          pay_type = ?, monthly_salary = ?, address = ?, nid = ?, on_leave = ?,
          joined = ?, expiry = ?,
          passport_country = ?, passport_number = ?, passport_expiry = ?,
          visa_number = ?, visa_expiry = ?,
          sia_badge_number = ?, sia_badge_expiry = ?,
          worker_type = ?, subcontract_company = ?
      WHERE id = ?`,
      [merged.name, merged.phone, merged.email, merged.location, merged.role, merged.rate,
       merged.pay_type, merged.monthly_salary, merged.address, merged.nid, merged.on_leave,
       merged.joined, merged.expiry,
       merged.passport_country, merged.passport_number, merged.passport_expiry,
       merged.visa_number, merged.visa_expiry,
       merged.sia_badge_number, merged.sia_badge_expiry,
       merged.worker_type, merged.subcontract_company, req.params.id]
    );

    // Before/after audit trail — only fields whose value actually changed.
    const LABELS = {
      name: 'Name', phone: 'Phone', email: 'Email', location: 'Location', role: 'Role',
      rate: 'Hourly rate', pay_type: 'Pay type', monthly_salary: 'Monthly salary',
      address: 'Address', nid: 'N.I. number', on_leave: 'On leave',
      joined: 'Joining date', expiry: 'Expiry date',
      passport_country: 'Passport country', passport_number: 'Passport number', passport_expiry: 'Passport expiry',
      visa_number: 'Visa number', visa_expiry: 'Visa expiry',
      sia_badge_number: 'SIA badge number', sia_badge_expiry: 'SIA badge expiry',
      worker_type: 'Employment type', subcontract_company: 'Sub-contract company',
    };
    const norm = (k, v) => {
      if (v === null || v === undefined) return null;
      if (k === 'on_leave') return v === true || v === 1 ? 'yes' : 'no';
      if (k === 'rate' || k === 'monthly_salary') return Number(v);
      if (k === 'joined' || k === 'expiry' || k.endsWith('_expiry')) return dateStr(v);
      return String(v);
    };
    const changes = {};
    for (const [col, label] of Object.entries(LABELS)) {
      const before = norm(col, cur[col]);
      const after = norm(col, merged[col]);
      if (before !== after) changes[label] = { from: before ?? '—', to: after ?? '—' };
    }

    await logActionFromReq(req, 'updated_worker', 'worker', req.params.id, {
      name: merged.name,
      changes,
    });
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

      await logActionFromReq(req, 'reactivated_worker', 'worker', req.params.id, {
        name: workers[0].name,
        newExpiry: expiry.toISOString().split('T')[0],
      });
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
    const [rows] = await pool.query('SELECT name, email FROM workers WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM workers WHERE id = ?', [req.params.id]);
    // Also remove the login account and future assignments — leaving the users
    // row orphaned blocks the same email from ever registering again.
    await pool.query('DELETE FROM users WHERE worker_id = ?', [req.params.id]);
    await pool.query('DELETE FROM worker_location_assignments WHERE worker_id = ?', [req.params.id]);
    await logActionFromReq(req, 'deleted_worker', 'worker', req.params.id, {
      name: rows[0]?.name, email: rows[0]?.email,
    });
    res.json({ message: 'Worker deleted successfully' });
  } catch (error) {
    console.error('Delete worker error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: registration documents for a worker (from their approved application).
// Returns the application id + available doc keys so the frontend can stream
// each file through the existing secure /api/applications/:id/document/:key route.
router.get('/:id/documents', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [apps] = await pool.query(
      'SELECT id, details FROM registration_applications WHERE worker_id = ? ORDER BY submitted DESC LIMIT 1',
      [req.params.id]
    );
    if (apps.length === 0) {
      return res.json({ applicationId: null, documents: [] });
    }
    const details = typeof apps[0].details === 'string'
      ? JSON.parse(apps[0].details || '{}')
      : (apps[0].details || {});
    const docUrls = details.docUrls || {};
    const LABELS = {
      photo: 'Profile Photo',
      proofAddress: 'Proof of Address',
      eVisa: 'eVisa',
      passportDoc: 'Passport Document',
      shareCode: 'UKVI Share Code',
      cv: 'CV (incl. 5 years address history)',
      siaDocFront: 'SIA Badge Front',
      siaDocBack: 'SIA Badge Back',
      rtwShareCode: 'Right-to-work Share Code',
    };
    const documents = Object.entries(docUrls)
      .filter(([, url]) => Boolean(url))
      .map(([key, url]) => ({
        key,
        label: LABELS[key] || key,
        name: String(url).split('/').pop() || key,
      }));
    res.json({ applicationId: apps[0].id, documents });
  } catch (error) {
    console.error('Worker documents error:', error);
    res.status(500).json({ error: 'Failed to load worker documents' });
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

    await logActionFromReq(req, 'reset_worker_password', 'worker', req.params.id);
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

    await logActionFromReq(req, 'updated_worker_compliance', 'worker', req.params.id, {
      complete: checks.filter((c) => c.status === 'complete').length,
      total: COMPLIANCE_KEYS.length,
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
