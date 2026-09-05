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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
