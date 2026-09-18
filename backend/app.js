require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pool = require('./config/database');
const bcrypt = require('bcryptjs');
const { checkExpiringWorkers } = require('./utils/expiry');

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`  - ${varName}`));
  if (!process.env.VERCEL) {
    console.error('Please check your .env file');
    process.exit(1);
  }
}

const app = express();

// Ensure schema is set up (idempotent — safe to run on every cold start)
async function ensureSchema() {
  try {
    // Add password_hash column to workers table if it doesn't exist
    try {
      await pool.query('ALTER TABLE workers ADD COLUMN password_hash VARCHAR(255) NULL AFTER status');
      console.log('✅ password_hash column added to workers table');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('✅ password_hash column already exists');
      } else {
        console.log('⚠️ Could not add password_hash column:', error.message);
      }
    }

    // Modify attendance.check_out_time to allow NULL
    try {
      await pool.query('ALTER TABLE attendance MODIFY COLUMN check_out_time TIME NULL');
      console.log('✅ attendance.check_out_time now allows NULL');
    } catch (error) {
      console.log('⚠️ Could not modify attendance.check_out_time:', error.message);
    }

    // Allow 'draft' status on registration_applications (save & resume feature)
    try {
      await pool.query(
        'ALTER TABLE registration_applications MODIFY COLUMN status ENUM(?,?,?,?) NOT NULL DEFAULT ?',
        ['pending', 'approved', 'rejected', 'draft', 'pending']
      );
      console.log('✅ registration_applications.status supports draft');
    } catch (error) {
      console.log('⚠️ Could not update status enum:', error.message);
    }

    // Statutory holiday accrual (12.07%): configurable rate + stored per-entry accrual
    const addCol = async (sql, label) => {
      try {
        await pool.query(sql);
        console.log(`✅ ${label} added`);
      } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') console.log(`✅ ${label} already exists`);
        else console.log(`⚠️ Could not add ${label}:`, error.message);
      }
    };
    await addCol('ALTER TABLE settings ADD COLUMN holiday_accrual_rate DECIMAL(5,2) NOT NULL DEFAULT 12.07', 'settings.holiday_accrual_rate');
    await addCol('ALTER TABLE attendance ADD COLUMN holiday_accrued_hours DECIMAL(8,4) NOT NULL DEFAULT 0', 'attendance.holiday_accrued_hours');
    await addCol('ALTER TABLE payroll ADD COLUMN holiday_accrued_hours DECIMAL(8,2) NOT NULL DEFAULT 0', 'payroll.holiday_accrued_hours');
    await addCol('ALTER TABLE payroll ADD COLUMN holiday_accrual_pay DECIMAL(10,2) NOT NULL DEFAULT 0', 'payroll.holiday_accrual_pay');

    // Pay type (Part 2): 'hourly' (default, existing behaviour) or 'salary'
    // (monthly-salaried, prorated by calendar days). Existing rows stay hourly.
    await addCol("ALTER TABLE workers ADD COLUMN pay_type ENUM('hourly','salary') NOT NULL DEFAULT 'hourly'", 'workers.pay_type');
    await addCol('ALTER TABLE workers ADD COLUMN monthly_salary DECIMAL(10,2) NULL', 'workers.monthly_salary');
    await addCol("ALTER TABLE registration_applications ADD COLUMN pay_type ENUM('hourly','salary') NOT NULL DEFAULT 'hourly'", 'registration_applications.pay_type');
    await addCol('ALTER TABLE registration_applications ADD COLUMN monthly_salary DECIMAL(10,2) NULL', 'registration_applications.monthly_salary');
    await addCol("ALTER TABLE payroll ADD COLUMN pay_type ENUM('hourly','salary') NOT NULL DEFAULT 'hourly'", 'payroll.pay_type');
    await addCol('ALTER TABLE payroll ADD COLUMN monthly_salary DECIMAL(10,2) NULL', 'payroll.monthly_salary');
    await addCol('ALTER TABLE payroll ADD COLUMN pay_details JSON NULL', 'payroll.pay_details');

    // Part 5: structured address fields on locations — a building picked by
    // postcode is stored as building / street / city / postcode.
    await addCol('ALTER TABLE locations ADD COLUMN building VARCHAR(255) NULL', 'locations.building');
    await addCol('ALTER TABLE locations ADD COLUMN street VARCHAR(255) NULL', 'locations.street');
    await addCol('ALTER TABLE locations ADD COLUMN city VARCHAR(100) NULL', 'locations.city');
    await addCol('ALTER TABLE locations ADD COLUMN postcode VARCHAR(12) NULL', 'locations.postcode');

    // Part 7: dual signatures — the company countersigns after the worker.
    // Statuses: pending → worker_signed → signed (both parties).
    await addCol('ALTER TABLE signature_requests ADD COLUMN admin_signature_type VARCHAR(20) NULL', 'signature_requests.admin_signature_type');
    await addCol('ALTER TABLE signature_requests ADD COLUMN admin_signature_data MEDIUMTEXT NULL', 'signature_requests.admin_signature_data');
    await addCol('ALTER TABLE signature_requests ADD COLUMN admin_signed_by VARCHAR(255) NULL', 'signature_requests.admin_signed_by');
    await addCol('ALTER TABLE signature_requests ADD COLUMN admin_signed_at TIMESTAMP NULL', 'signature_requests.admin_signed_at');
    await addCol('ALTER TABLE signature_requests ADD COLUMN admin_signer_ip VARCHAR(64) NULL', 'signature_requests.admin_signer_ip');

    // Part 11: payroll payment status — who/when a run was paid plus an
    // optional payment reference, and a permanent audit table that keeps a
    // record of every status change even if the payroll row is later deleted.
    await addCol('ALTER TABLE payroll ADD COLUMN paid_at DATETIME NULL', 'payroll.paid_at');
    await addCol('ALTER TABLE payroll ADD COLUMN paid_by VARCHAR(255) NULL', 'payroll.paid_by');
    await addCol('ALTER TABLE payroll ADD COLUMN payment_reference VARCHAR(255) NULL', 'payroll.payment_reference');
    try {
      // Widen the status enum, migrate legacy rows, then narrow to the new vocabulary
      await pool.query("ALTER TABLE payroll MODIFY COLUMN status ENUM('Pending','Completed','Paid') NOT NULL DEFAULT 'Pending'");
      await pool.query("UPDATE payroll SET status = 'Paid' WHERE status = 'Completed'");
      await pool.query("ALTER TABLE payroll MODIFY COLUMN status ENUM('Pending','Paid') NOT NULL DEFAULT 'Pending'");
      console.log('✅ payroll status migrated to Pending/Paid');
    } catch (error) {
      console.log('⚠️ Could not migrate payroll status enum:', error.message);
    }
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS payroll_payment_log (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          payroll_id VARCHAR(64) NOT NULL,
          worker_id VARCHAR(64) NULL,
          worker VARCHAR(255) NULL,
          period_start DATE NULL,
          period_end DATE NULL,
          net_pay DECIMAL(12,2) NULL,
          action VARCHAR(32) NOT NULL,
          status VARCHAR(32) NOT NULL,
          actor VARCHAR(255) NULL,
          payment_reference VARCHAR(255) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_payroll_payment_log_payroll (payroll_id),
          INDEX idx_payroll_payment_log_created (created_at)
        )`
      );
      console.log('✅ payroll_payment_log table ready');
    } catch (error) {
      console.log('⚠️ Could not create payroll_payment_log table:', error.message);
    }

    // Action History audit log
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS action_logs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          actor_type ENUM('admin', 'worker', 'system') NOT NULL DEFAULT 'system',
          actor_id VARCHAR(64) NULL,
          actor_name VARCHAR(255) NULL,
          action VARCHAR(100) NOT NULL,
          target_type VARCHAR(50) NULL,
          target_id VARCHAR(64) NULL,
          details JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_action_logs_created (created_at),
          INDEX idx_action_logs_action (action),
          INDEX idx_action_logs_actor (actor_type, actor_id)
        )`
      );
      console.log('✅ action_logs table ready');
    } catch (error) {
      console.log('⚠️ Could not create action_logs table:', error.message);
    }

    // Incident reporting
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS incidents (
          id VARCHAR(50) NOT NULL PRIMARY KEY,
          reported_by VARCHAR(64) NOT NULL,
          reporter_name VARCHAR(255) NOT NULL,
          location_id VARCHAR(50) NULL,
          location_name VARCHAR(255) NULL,
          attendance_id VARCHAR(50) NULL,
          category VARCHAR(50) NOT NULL,
          description TEXT NOT NULL,
          severity ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
          status ENUM('Open', 'Under Review', 'Resolved', 'Closed') NOT NULL DEFAULT 'Open',
          internal_notes JSON NULL,
          attachments JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_incidents_status (status),
          INDEX idx_incidents_severity (severity),
          INDEX idx_incidents_location (location_id),
          INDEX idx_incidents_created (created_at)
        )`
      );
      console.log('✅ incidents table ready');
    } catch (error) {
      console.log('⚠️ Could not create incidents table:', error.message);
    }

    // Team page: optional note/details on admin accounts (used by admin invites)
    await addCol('ALTER TABLE users ADD COLUMN note VARCHAR(500) NULL', 'users.note');

    // Client portal (Phase 4): 'client' user role + clients/client_locations tables
    try {
      await pool.query(
        "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'worker', 'client') NOT NULL"
      );
      console.log('✅ users.role supports client');
    } catch (error) {
      console.log('⚠️ Could not extend users.role enum:', error.message);
    }
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS clients (
          id VARCHAR(50) NOT NULL PRIMARY KEY,
          user_id INT NOT NULL,
          name VARCHAR(255) NOT NULL,
          company VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          buyer_name VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_clients_user (user_id),
          INDEX idx_clients_buyer (buyer_name)
        )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS client_locations (
          client_id VARCHAR(50) NOT NULL,
          location_id VARCHAR(50) NOT NULL,
          UNIQUE KEY uq_client_location (client_id, location_id)
        )`
      );
      console.log('✅ clients + client_locations tables ready');
    } catch (error) {
      console.log('⚠️ Could not create client tables:', error.message);
    }

    // Part 6: clients are internal admin reference records — no portal login.
    // user_id becomes optional and the record gains address/phone/status/notes.
    try {
      await pool.query('ALTER TABLE clients MODIFY COLUMN user_id INT NULL');
      console.log('✅ clients.user_id now nullable');
    } catch (e) {
      console.log('⚠️ clients.user_id modify:', e.message);
    }
    await addCol('ALTER TABLE clients ADD COLUMN address VARCHAR(500) NULL', 'clients.address');
    await addCol('ALTER TABLE clients ADD COLUMN phone VARCHAR(50) NULL', 'clients.phone');
    await addCol("ALTER TABLE clients ADD COLUMN status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active'", 'clients.status');
    await addCol('ALTER TABLE clients ADD COLUMN notes TEXT NULL', 'clients.notes');
  } catch (error) {
    console.error('Schema setup error:', error);
  }
}

// Middleware
// Allow all origins (API is consumed by the same-origin frontend on Vercel,
// and by the Vite dev server locally)
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve uploaded files statically.
// NOTE: on Vercel the filesystem is ephemeral (/tmp) — uploads work within a
// single function instance but do not persist. Local disk is used when running
// the standalone server.
const uploadRoot = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });
} catch (e) {
  console.log('⚠️ Could not create upload dir:', e.message);
}
app.use('/uploads', express.static(uploadRoot));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/worker/attendance', require('./routes/worker-attendance'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/buyer-income', require('./routes/buyer-income'));
app.use('/api/other-costs', require('./routes/other-costs'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/expiry', require('./routes/expiry'));
app.use('/api/action-logs', require('./routes/action-logs'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/admins', require('./routes/admins'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'HR & Payroll API is running' });
});

// Cron endpoint — invoked by Vercel Cron (see vercel.json / build output).
// Vercel sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
app.get('/api/cron/expiry-check', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers['authorization'] || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await checkExpiringWorkers();
    res.json({ ok: true, result });
  } catch (err) {
    console.error('Cron expiry check failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Run schema check once per process (cold start on Vercel, once at boot locally)
const ready = ensureSchema().catch(err => console.error('Schema init failed:', err));

module.exports = { app, ready, checkExpiringWorkers };
