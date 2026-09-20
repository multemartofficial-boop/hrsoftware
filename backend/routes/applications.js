const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { appBaseUrl } = require('../utils/app-url');
const { logActionFromReq } = require('../utils/action-log');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // /tmp on Vercel (ephemeral); local uploads/ dir otherwise
    const uploadDir = process.env.VERCEL ? '/tmp/uploads/documents' : 'uploads/documents';
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
  limits: {
    fileSize: 3 * 1024 * 1024, // 3MB per file
    fieldSize: 10 * 1024 * 1024,
    files: 20,
    fields: 100,
  },
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

// Default admin compliance checklist (Phase A). Stored as JSON in `compliance`.
const blankCompliance = () => ({
  electronicId: false,
  addressHistory: false,
  financialChecks: false,
  rightToWork: false,
  employmentHistory5y: false,
  gapPeriods: false,
  academicQualifications: false,
  criminalRecords: false,
  criminalRecordsLevel: '',
});

// Map a DB application row to the shape the frontend expects (camelCase + parsed JSON fields)
const transformApplication = (app) => {
  let compliance = blankCompliance();
  if (app.compliance) {
    try {
      const parsed = typeof app.compliance === 'string' ? JSON.parse(app.compliance) : app.compliance;
      compliance = { ...compliance, ...(parsed || {}) };
    } catch {
      /* keep defaults if the stored JSON is unreadable */
    }
  }
  let details = {};
  if (app.details) {
    try {
      details = typeof app.details === 'string' ? JSON.parse(app.details) : app.details;
    } catch {
      /* keep as empty object if the stored JSON is unreadable */
    }
  }
  return {
    ...app,
    details,
    workerId: app.worker_id,
    // True only when the worker row exists AND password_hash is set —
    // i.e. the worker actually completed password setup.
    passwordSet: app.password_set !== undefined ? !!app.password_set : null,
    worker_joined: app.worker_joined,
    worker_expiry: app.worker_expiry,
    rejectedOn: app.rejected_on,
    appliedFor: app.applied_for,
    howHeard: app.how_heard,
    subcontractCompany: app.subcontract_company,
    workerType: app.worker_type || 'Direct',
    employmentType: app.employment_type === 'full_time' ? 'full_time' : 'irregular',
    payType: app.pay_type === 'salary' ? 'salary' : 'hourly',
    monthlySalary: app.monthly_salary != null ? Number(app.monthly_salary) : null,
    passportCountry: app.passport_country,
    passportNumber: app.passport_number,
    passportIssueDate: app.passport_issue_date,
    passportExpiry: app.passport_expiry,
    visaNumber: app.visa_number,
    visaIssueDate: app.visa_issue_date,
    visaExpiry: app.visa_expiry,
    siaBadgeNumber: app.sia_badge_number,
    siaBadgeExpiry: app.sia_badge_expiry,
    hasVisa: app.has_visa,
    gdprConsent: app.gdpr_consent,
    compliance,
  };
};

// Generate unique application ID
const generateApplicationId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `APP-${year}-${random}`;
};

// Public: Submit new application
const appUploadFields = [
  { name: 'photo', maxCount: 1 },
  { name: 'proofAddress', maxCount: 1 },
  { name: 'passportDoc', maxCount: 1 },
  { name: 'eVisa', maxCount: 1 },
  { name: 'siaDocFront', maxCount: 1 },
  { name: 'siaDocBack', maxCount: 1 },
  { name: 'cv', maxCount: 1 },
  { name: 'shareCode', maxCount: 1 },
  { name: 'rtwShareCode', maxCount: 1 }
];

const DOC_KEYS = ['photo', 'proofAddress', 'passportDoc', 'eVisa', 'siaDocFront', 'siaDocBack', 'cv', 'shareCode', 'rtwShareCode'];

const buildDocUrls = (req, existing = {}) => {
  const docUrls = { ...existing };
  for (const k of DOC_KEYS) {
    docUrls[k] = req.files && req.files[k] ? `/uploads/documents/${req.files[k][0].filename}` : (existing[k] || '');
  }
  return docUrls;
};

// Delete draft applications older than 30 days so abandoned drafts don't pile up
const cleanupOldDrafts = async () => {
  await pool.query(
    'DELETE FROM registration_applications WHERE status = "draft" AND submitted < NOW() - INTERVAL 30 DAY'
  );
};

// Public: save a draft application (autosave / resume later)
router.post('/draft', upload.fields(appUploadFields), async (req, res) => {
  try {
    await cleanupOldDrafts();
    const { email, lastStep, existingDocs } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Email is required to save a draft' });
    }
    let prevDocs = {};
    try { prevDocs = JSON.parse(existingDocs || '{}'); } catch { prevDocs = {}; }
    const docUrls = buildDocUrls(req, prevDocs);

    // Keep every posted field so the form can be fully restored
    const details = { ...req.body, docUrls };
    delete details.existingDocs;

    const [rows] = await pool.query(
      'SELECT id FROM registration_applications WHERE email = ? AND status = "draft" ORDER BY submitted DESC LIMIT 1',
      [email]
    );
    let appId;
    if (rows.length) {
      appId = rows[0].id;
      await pool.query(
        'UPDATE registration_applications SET details = ?, submitted = NOW() WHERE id = ?',
        [JSON.stringify(details), appId]
      );
    } else {
      appId = generateApplicationId();
      await pool.query(
        `INSERT INTO registration_applications
        (id, name, submitted, phone, email, address, nid, applied_for, location, rate, status, details)
        VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [appId, `${req.body.forename || ''} ${req.body.surname || ''}`.trim() || 'Draft',
         req.body.mobile || '', email, req.body.addr1 || '', req.body.ni || '', req.body.appliedFor || 'Unspecified',
         '', req.body.rate || 0, JSON.stringify(details)]
      );
    }
    res.json({ id: appId, docUrls, message: 'Draft saved' });
  } catch (error) {
    console.error('Draft save error:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// Public: fetch a saved draft by email (for "resume your application")
router.get('/draft', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const [rows] = await pool.query(
      'SELECT id, details, submitted FROM registration_applications WHERE email = ? AND status = "draft" ORDER BY submitted DESC LIMIT 1',
      [email]
    );
    if (!rows.length) return res.status(404).json({ error: 'No saved application found for that email' });
    const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : rows[0].details;
    res.json({ id: rows[0].id, details, submitted: rows[0].submitted });
  } catch (error) {
    console.error('Draft fetch error:', error);
    res.status(500).json({ error: 'Failed to load draft' });
  }
});

router.post('/', upload.fields(appUploadFields), async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      appliedFor, title, surname, forename, dob, birthSurname, nameChangeDate,
      mobile, email, addr1, addr2, addr3, town, county, postcode, country, addressFrom,
      birthPlace, nationality, religion, ni, rtw,
      kinForename, kinSurname, kinPhone, kinAddr1, kinAddr2, kinAddr3, kinTown, kinCounty, kinPostcode, kinCountry,
      hasVisa, visaType, visaIssueDate, visaExpiry,
      bankName, accountHolder, sortAccount,
      medical, dietary,
      workedBefore, beforeFrom, beforeTo, beforeReason,
      availability, rate, prefLocations,
      prevAddresses, employers, referees, skills,
      howHeard, subcontractCompany, passportCountry, passportNumber, passportIssueDate, passportExpiry,
      visaNumber, siaBadgeNumber, siaBadgeExpiry,
      passportType, sortCode, accountNumber, gdprConsent, termsConsent
    } = req.body;

    // Direct vs Sub-contract: derived from the how-heard answer
    const workerType = howHeard === 'Sub-contract' ? 'Sub-contract' : 'Direct';

    // Optional date fields must be NULL (not '') for MySQL DATE columns
    const nullableDate = (v) => (v && String(v).trim() ? v : null);

    // Random 4-digit IDs collide as applications accumulate — retry until unused
    let applicationId = generateApplicationId();
    for (let i = 0; i < 10; i++) {
      const [dup] = await connection.query('SELECT id FROM registration_applications WHERE id = ?', [applicationId]);
      if (dup.length === 0) break;
      applicationId = generateApplicationId();
    }
    const address = [addr1, addr2, addr3, town, county, postcode, country].filter(Boolean).join(', ');

    // Parse JSON fields
    const parsedPrevAddresses = prevAddresses ? JSON.parse(prevAddresses) : [];
    const parsedEmployers = employers ? JSON.parse(employers) : [];
    const parsedReferees = referees ? JSON.parse(referees) : [];
    const parsedSkills = skills ? JSON.parse(skills) : [];
    const parsedPrefLocations = prefLocations ? JSON.parse(prefLocations) : [];

    // A resumed application may have docs already stored on its draft — merge them
    let existingDocs = {};
    try { existingDocs = JSON.parse(req.body.existingDocs || '{}'); } catch { existingDocs = {}; }
    const docUrls = buildDocUrls(req, existingDocs);

    // If a draft exists for this email, remove it (child rows are only written for
    // final submissions, so deleting the draft row is enough)
    await connection.query(
      'DELETE FROM registration_applications WHERE email = ? AND status = "draft"',
      [email]
    );

    // Build details object
    const details = {
      appliedFor,
      title, surname, forename, dob, birthSurname, nameChangeDate,
      mobile, email, addr1, addr2, addr3, town, county, postcode, country, addressFrom,
      birthPlace, nationality, religion, ni, rtw,
      kinForename, kinSurname, kinPhone, kinAddr1, kinAddr2, kinAddr3, kinTown, kinCounty, kinPostcode, kinCountry,
      hasVisa, visaType, visaIssueDate, visaExpiry,
      bankName, accountHolder, sortAccount,
      medical, dietary,
      workedBefore, beforeFrom, beforeTo, beforeReason,
      availability, rate, prefLocations: parsedPrefLocations,
      prevAddresses: parsedPrevAddresses,
      employers: parsedEmployers,
      referees: parsedReferees,
      skills: parsedSkills,
      docUrls,
      howHeard, subcontractCompany, workerType,
      passportCountry, passportNumber, passportIssueDate, passportExpiry,
      visaNumber, siaBadgeNumber, siaBadgeExpiry,
      passportType, sortCode, accountNumber, gdprConsent, termsConsent
    };

    // Insert main application
    await connection.query(
      `INSERT INTO registration_applications
      (id, name, submitted, phone, email, address, nid, applied_for, location, rate, status, details,
       how_heard, subcontract_company, worker_type, passport_country, passport_number, passport_expiry,
       visa_number, visa_expiry, sia_badge_number, sia_badge_expiry)
      VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [applicationId, `${forename} ${surname}`, mobile, email, address, ni, appliedFor || 'Unspecified',
       parsedPrefLocations[0] || 'Unassigned', rate || 0, JSON.stringify(details),
       howHeard || null,
       workerType === 'Sub-contract' ? (subcontractCompany || null) : null, workerType,
       passportCountry || null, passportNumber || null, nullableDate(passportExpiry),
       visaNumber || null, nullableDate(visaExpiry), siaBadgeNumber || null, nullableDate(siaBadgeExpiry)]
    );

    // Insert previous addresses
    for (const addr of parsedPrevAddresses) {
      await connection.query(
        `INSERT INTO worker_previous_addresses 
        (application_id, line1, line2, line3, town, county, postcode, country, from_date, to_date) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [applicationId, addr.line1, addr.line2, addr.line3, addr.town, addr.county || '', 
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
        [applicationId, ref.name || '', ref.phone, ref.email, ref.address, ref.years, ref.relationship]
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
    const { status } = req.query;
    let query = `SELECT a.*, (w.password_hash IS NOT NULL) AS password_set
      FROM registration_applications a
      LEFT JOIN workers w ON w.id = a.worker_id`;
    const params = [];

    if (status === 'approved') {
      query += ' WHERE a.status = "approved"';
    } else if (status === 'rejected') {
      query += ' WHERE a.status = "rejected"';
    } else {
      query += ' WHERE a.status = "pending"';
    }

    query += ' ORDER BY a.submitted DESC';

    const [applications] = await pool.query(query, params);
    res.json(applications.map(transformApplication));
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
    res.json(applications.map(transformApplication));
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

    res.json(transformApplication(applications[0]));
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Securely stream an uploaded application document by doc key.
// The file path is read from the stored details.docUrls map, so only files
// attached to this application can be requested.
router.get('/:id/document/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [applications] = await pool.query(
      'SELECT details FROM registration_applications WHERE id = ?',
      [req.params.id]
    );
    if (applications.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    const details = typeof applications[0].details === 'string'
      ? JSON.parse(applications[0].details || '{}')
      : (applications[0].details || {});
    const docUrls = details.docUrls || {};
    const docUrl = docUrls[req.params.key];
    if (!docUrl) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let filePath = '';
    if (docUrl.startsWith('/uploads/documents/')) {
      const filename = docUrl.replace('/uploads/documents/', '');
      filePath = process.env.VERCEL
        ? path.join('/tmp/uploads/documents', filename)
        : path.join(__dirname, '..', 'uploads', 'documents', filename);
    } else if (docUrl.startsWith('/uploads/')) {
      const rest = docUrl.replace('/uploads/', '');
      filePath = process.env.VERCEL
        ? path.join('/tmp/uploads', rest)
        : path.join(__dirname, '..', 'uploads', rest);
    } else {
      return res.status(400).json({ error: 'Unsupported document URL' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.pdf'
      ? 'application/pdf'
      : ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('Document view error:', error);
    res.status(500).json({ error: 'Server error while loading document' });
  }
});

// Admin: Save the compliance checklist for an application
router.put('/:id/compliance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [applications] = await pool.query(
      'SELECT id FROM registration_applications WHERE id = ?',
      [req.params.id]
    );
    if (applications.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const incoming = req.body || {};
    const allowed = blankCompliance();
    const compliance = {};
    for (const key of Object.keys(allowed)) {
      if (key === 'criminalRecordsLevel') {
        compliance[key] = incoming[key] ? String(incoming[key]) : '';
      } else {
        compliance[key] = Boolean(incoming[key]);
      }
    }

    await pool.query(
      'UPDATE registration_applications SET compliance = ? WHERE id = ?',
      [JSON.stringify(compliance), req.params.id]
    );

    res.json({ compliance, message: 'Compliance checklist saved' });
  } catch (error) {
    console.error('Save compliance error:', error);
    res.status(500).json({ error: 'Server error while saving compliance checklist' });
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

    if (application.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ error: `Application is already ${application.status}` });
    }

    // Pay type (Part 2): 'hourly' (default, unchanged behaviour) or 'salary'.
    // For hourly workers the admin-confirmed hourly rate is required; for
    // salaried workers a monthly salary amount is required instead.
    const payType = (req.body.payType || req.body.pay_type) === 'salary' ? 'salary' : 'hourly';
    const confirmedRate = req.body.rate !== undefined && req.body.rate !== null && req.body.rate !== ''
      ? Number(req.body.rate)
      : Number(application.rate);
    let monthlySalary = null;
    if (payType === 'salary') {
      const raw = req.body.monthlySalary ?? req.body.monthly_salary;
      monthlySalary = raw !== undefined && raw !== null && raw !== ''
        ? Number(raw)
        : Number(application.monthly_salary);
      if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'A valid monthly salary greater than 0 is required' });
      }
    } else if (!Number.isFinite(confirmedRate) || confirmedRate <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'A valid hourly rate greater than 0 is required' });
    }

    // Contract type (Part 12): 'irregular' (zero-hours → 12.07% accrual) or
    // 'full_time' (permanent → 28-day statutory entitlement).
    const employmentType = (req.body.employmentType || req.body.employment_type) === 'full_time'
      ? 'full_time' : 'irregular';

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

    // Generate setup token (48 hour expiry)
    const setupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 48);
    const tokenExpiryFormatted = tokenExpiry.toISOString().slice(0, 19).replace('T', ' ');

    // Store setup token
    await connection.query(
      `INSERT INTO password_reset_tokens 
      (email, worker_id, token, token_type, expires_at) 
      VALUES (?, ?, ?, 'setup', ?)`,
      [application.email, workerId, setupToken, tokenExpiryFormatted]
    );

    // Update application status and store worker info temporarily
    await connection.query(
      `UPDATE registration_applications
      SET status = "approved",
          worker_id = ?,
          worker_joined = ?,
          worker_expiry = ?,
          approval_token = ?,
          rate = ?,
          pay_type = ?,
          monthly_salary = ?,
          employment_type = ?
      WHERE id = ?`,
      [workerId, joined, expiry, setupToken,
       payType === 'salary' ? 0 : confirmedRate, payType, monthlySalary, employmentType, req.params.id]
    );

    // Send email with setup link
    const setupLink = `${appBaseUrl(req)}/setup-password?token=${setupToken}`;
    const emailHtml = `
      <h2>Welcome to WorkHR!</h2>
      <p>Your application has been approved and your worker account has been created.</p>
      <p><strong>Worker Code:</strong> ${workerId}</p>
      <p><strong>${payType === 'salary' ? 'Monthly Salary' : 'Hourly Rate'}:</strong> £${(payType === 'salary' ? monthlySalary : confirmedRate).toFixed(2)}${payType === 'salary' ? ' / month' : ' / hour'}</p>
      <p><strong>Join Date:</strong> ${joined.toISOString().split('T')[0]}</p>
      <p><strong>Expiry Date:</strong> ${expiry.toISOString().split('T')[0]}</p>
      <p>To set your password and complete your account setup, click the link below:</p>
      <p><a href="${setupLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Set Up Your Password</a></p>
      <p>This link will expire in 48 hours.</p>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await sendEmail({
      to: application.email,
      subject: `Welcome to WorkHR - Your Worker Account: ${workerId}`,
      html: emailHtml,
      text: `Your WorkHR application has been approved. Worker Code: ${workerId}. Set your password at: ${setupLink}`
    });

    // Skip notification for now - worker doesn't exist yet
    // Will be added after password setup

    await connection.commit();
    await logActionFromReq(req, 'approved_application', 'application', req.params.id, {
      applicant: application.name,
      email: application.email,
      workerId,
      rate: payType === 'salary' ? null : confirmedRate,
      payType,
      monthlySalary,
      employmentType,
    });
    res.json({
      id: workerId,
      expiry: expiry.toISOString().split('T')[0],
      workerId,
      rate: payType === 'salary' ? 0 : confirmedRate,
      payType,
      monthlySalary,
      message: 'Application approved successfully. Setup link sent to worker email.',
      setupLink: setupLink // Include for testing
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

    await logActionFromReq(req, 'rejected_application', 'application', req.params.id, {
      applicant: applications[0].name,
      email: applications[0].email,
    });
    res.json({ message: 'Application rejected successfully' });
  } catch (error) {
    console.error('Reject application error:', error);
    res.status(500).json({ error: 'Server error during rejection' });
  }
});

// Admin: Resend verification link
router.post('/:id/resend-setup', requireAuth, requireAdmin, async (req, res) => {
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

    if (application.status !== 'approved' || !application.worker_id) {
      await connection.rollback();
      return res.status(400).json({ error: 'Application must be approved before resending setup link' });
    }

    // Check if worker already exists
    const [existingWorkers] = await connection.query(
      'SELECT * FROM workers WHERE id = ?',
      [application.worker_id]
    );

    if (existingWorkers.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Worker account already exists and has completed setup' });
    }

    // Invalidate old tokens for this email
    await connection.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE email = ? AND token_type = "setup"',
      [application.email]
    );

    // Generate new setup token (48 hour expiry)
    const setupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 48);
    const tokenExpiryFormatted = tokenExpiry.toISOString().slice(0, 19).replace('T', ' ');

    // Store new setup token
    await connection.query(
      `INSERT INTO password_reset_tokens 
      (email, worker_id, token, token_type, expires_at) 
      VALUES (?, ?, ?, 'setup', ?)`,
      [application.email, application.worker_id, setupToken, tokenExpiryFormatted]
    );

    // Update application with new token
    await connection.query(
      'UPDATE registration_applications SET approval_token = ? WHERE id = ?',
      [setupToken, req.params.id]
    );

    // Send email with new setup link
    const setupLink = `${appBaseUrl(req)}/setup-password?token=${setupToken}`;
    const emailHtml = `
      <h2>WorkHR Account Setup</h2>
      <p>Your worker account has been created.</p>
      <p><strong>Worker Code:</strong> ${application.worker_id}</p>
      <p><strong>Join Date:</strong> ${application.worker_joined}</p>
      <p><strong>Expiry Date:</strong> ${application.worker_expiry}</p>
      <p>To set your password and complete your account setup, click the link below:</p>
      <p><a href="${setupLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Set Up Your Password</a></p>
      <p>This link will expire in 48 hours and replaces any previous setup links.</p>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await sendEmail({
      to: application.email,
      subject: `WorkHR Account Setup - Worker Code: ${application.worker_id}`,
      html: emailHtml,
      text: `Your WorkHR worker account has been created. Worker Code: ${application.worker_id}. Set your password at: ${setupLink}`
    });

    await connection.commit();
    await logActionFromReq(req, 'resent_setup_link', 'application', req.params.id, {
      applicant: application.name,
      email: application.email,
      workerId: application.worker_id,
    });
    res.json({
      message: 'Setup link resent successfully',
      setupLink: setupLink // Include for testing
    });
  } catch (error) {
    await connection.rollback();
    console.error('Resend setup link error:', error);
    res.status(500).json({ error: 'Server error during resend' });
  } finally {
    connection.release();
  }
});

module.exports = router;
