const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/documents';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images and PDFs are allowed'));
  }
});

// Generate unique application ID
const generateApplicationId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `APP-${year}-${random}`;
};

// Public: Submit new application
router.post('/', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'proofAddress', maxCount: 1 }
]), async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      title, surname, forename, dob, birthSurname, nameChangeDate,
      mobile, email, addr1, addr2, addr3, town, county, postcode, country, addressFrom,
      birthPlace, nationality, ni, rtw,
      kinForename, kinSurname, kinPhone, kinAddr1, kinAddr2, kinAddr3, kinTown, kinCounty, kinPostcode, kinCountry,
      hasVisa, visaType, visaExpiry,
      bankName, accountHolder, sortAccount,
      medical, dietary,
      workedBefore, beforeFrom, beforeTo, beforeReason,
      availability, rate, prefLocations,
      prevAddresses, employers, referees, skills
    } = req.body;

    const applicationId = generateApplicationId();
    const address = [addr1, addr2, addr3, town, county, postcode, country].filter(Boolean).join(', ');

    // Parse JSON fields
    const parsedPrevAddresses = prevAddresses ? JSON.parse(prevAddresses) : [];
    const parsedEmployers = employers ? JSON.parse(employers) : [];
    const parsedReferees = referees ? JSON.parse(referees) : [];
    const parsedSkills = skills ? JSON.parse(skills) : [];
    const parsedPrefLocations = prefLocations ? JSON.parse(prefLocations) : [];

    // Build document URLs (handle missing files gracefully)
    const docUrls = {
      photo: req.files && req.files['photo'] ? `/uploads/documents/${req.files['photo'][0].filename}` : '',
      idFront: req.files && req.files['idFront'] ? `/uploads/documents/${req.files['idFront'][0].filename}` : '',
      idBack: req.files && req.files['idBack'] ? `/uploads/documents/${req.files['idBack'][0].filename}` : '',
      proofAddress: req.files && req.files['proofAddress'] ? `/uploads/documents/${req.files['proofAddress'][0].filename}` : ''
    };

    // Build details object
    const details = {
      title, surname, forename, dob, birthSurname, nameChangeDate,
      mobile, email, addr1, addr2, addr3, town, county, postcode, country, addressFrom,
      birthPlace, nationality, ni, rtw,
      kinForename, kinSurname, kinPhone, kinAddr1, kinAddr2, kinAddr3, kinTown, kinCounty, kinPostcode, kinCountry,
      hasVisa, visaType, visaExpiry,
      bankName, accountHolder, sortAccount,
      medical, dietary,
      workedBefore, beforeFrom, beforeTo, beforeReason,
      availability, rate, prefLocations: parsedPrefLocations,
      prevAddresses: parsedPrevAddresses,
      employers: parsedEmployers,
      referees: parsedReferees,
      skills: parsedSkills,
      docUrls
    };

    // Insert main application
    await connection.query(
      `INSERT INTO registration_applications 
      (id, name, submitted, phone, email, address, nid, applied_for, location, rate, status, details) 
      VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [applicationId, `${forename} ${surname}`, mobile, email, address, ni, 'Site Operative', 
       parsedPrefLocations[0] || 'Unassigned', rate || 14.50, JSON.stringify(details)]
    );

    // Insert previous addresses
    for (const addr of parsedPrevAddresses) {
      await connection.query(
        `INSERT INTO worker_previous_addresses 
        (application_id, line1, line2, line3, town, county, postcode, country, from_date, to_date) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, addr.line1, addr.line2, addr.line3, addr.town, addr.county, 
         addr.postcode, addr.country, addr.from, addr.to]
      );
    }

    // Insert employment history
    for (const emp of parsedEmployers) {
      await connection.query(
        `INSERT INTO worker_employment_history 
        (application_id, name, address, town, postcode, phone, email, role, from_date, to_date, reason) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, emp.name, emp.address, emp.town, emp.postcode, emp.phone, 
         emp.email, emp.role, emp.from, emp.to, emp.reason]
      );
    }

    // Insert referees
    for (const ref of parsedReferees) {
      await connection.query(
        `INSERT INTO worker_referees 
        (application_id, name, phone, email, address, years, relationship) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, ref.name, ref.phone, ref.email, ref.address, ref.years, ref.relationship]
      );
    }

    // Insert qualifications
    for (const skill of parsedSkills) {
      await connection.query(
        `INSERT INTO worker_qualifications 
        (application_id, name, number, attained, expiry) 
        VALUES (?, ?, ?, ?, ?)`,
        [applicationId, skill.name, skill.number, skill.attained, skill.expiry]
      );
    }

    await connection.commit();
    res.status(201).json({ id: applicationId, message: 'Application submitted successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Application submission error:', error);
    res.status(500).json({ error: 'Server error during application submission' });
  } finally {
    connection.release();
  }
});

// Admin: Get all pending applications
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [applications] = await pool.query(
      'SELECT * FROM registration_applications WHERE status = "pending" ORDER BY submitted DESC'
    );
    res.json(applications);
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({ error: true, message: 'Failed to load applications' });
  }
});

// Admin: Get rejected applications
router.get('/rejected', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [applications] = await pool.query(
      'SELECT * FROM registration_applications WHERE status = "rejected" ORDER BY rejected_on DESC'
    );
    res.json(applications);
  } catch (error) {
    console.error('Get rejected applications error:', error);
    res.status(500).json({ error: true, message: 'Failed to load rejected applications' });
  }
});

// Admin: Get single application
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [applications] = await pool.query(
      'SELECT * FROM registration_applications WHERE id = ?',
      [req.params.id]
    );

    if (applications.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json(applications[0]);
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Approve application
router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const [applications] = await pool.query(
      'SELECT * FROM registration_applications WHERE id = ?',
      [req.params.id]
    );

    if (applications.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Application not found' });
    }

    const application = applications[0];
    const details = typeof application.details === 'string'
      ? JSON.parse(application.details || '{}')
      : (application.details || {});

    // Generate worker code
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
    const workerId = `WKR-${year}-${String(nextNum).padStart(4, '0')}`;

    // Calculate expiry date (3 months from now)
    const joined = new Date();
    const expiry = new Date(joined);
    expiry.setMonth(expiry.getMonth() + 3);

    // Generate temporary password for worker
    const tempPassword = Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Insert worker
    await connection.query(
      `INSERT INTO workers 
      (id, name, phone, email, location, role, rate, joined, expiry, address, nid, status, password_hash) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [workerId, application.name, application.phone, application.email, application.location,
       application.applied_for, application.rate, joined, expiry, application.address, application.nid, passwordHash]
    );

    // Move related data from application to worker
    await connection.query(
      'UPDATE worker_previous_addresses SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [workerId, req.params.id]
    );

    await connection.query(
      'UPDATE worker_employment_history SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [workerId, req.params.id]
    );

    await connection.query(
      'UPDATE worker_referees SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [workerId, req.params.id]
    );

    await connection.query(
      'UPDATE worker_qualifications SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [workerId, req.params.id]
    );

    // Update application status
    await connection.query(
      'UPDATE registration_applications SET status = "approved" WHERE id = ?',
      [req.params.id]
    );

    // Create user account for worker
    await connection.query(
      'INSERT INTO users (name, email, password_hash, role, worker_id) VALUES (?, ?, ?, "worker", ?)',
      [application.name, application.email, passwordHash, workerId]
    );

    // Log notification
    await connection.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "info", "Just now")',
      [`N-${Date.now()}`, application.name, workerId, `Approved — worker code ${workerId} issued`]
    );

    await connection.commit();
    res.json({
      id: workerId,
      expiry: expiry.toISOString().split('T')[0],
      workerId,
      message: 'Application approved successfully',
      tempPassword // In production, send this via email
    });
  } catch (error) {
    await connection.rollback();
    console.error('Approve application error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sql: error.sql
    });
    res.status(500).json({ error: 'Server error during approval', details: error.message });
  } finally {
    connection.release();
  }
});

// Admin: Reject application
router.post('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [applications] = await pool.query(
      'SELECT * FROM registration_applications WHERE id = ?',
      [req.params.id]
    );

    if (applications.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await pool.query(
      'UPDATE registration_applications SET status = "rejected", rejected_on = NOW() WHERE id = ?',
      [req.params.id]
    );

    // Log notification
    await pool.query(
      'INSERT INTO notifications (id, worker, message, urgency, occurred_at) VALUES (?, ?, ?, "info", "Just now")',
      [`N-${Date.now()}`, applications[0].name, 'Application rejected']
    );

    res.json({ message: 'Application rejected successfully' });
  } catch (error) {
    console.error('Reject application error:', error);
    res.status(500).json({ error: 'Server error during rejection' });
  }
});

module.exports = router;
