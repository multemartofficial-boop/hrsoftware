require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./config/database');
const bcrypt = require('bcryptjs');
const { checkExpiringWorkers } = require('./utils/expiry');

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`  - ${varName}`));
  console.error('Please check your .env file');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure schema is set up on server start
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
    
    // Set default password for existing worker WKR-2026-0147 if it doesn't have one
    try {
      const [workers] = await pool.query('SELECT id, password_hash FROM workers WHERE id = ?', ['WKR-2026-0147']);
      if (workers.length > 0 && !workers[0].password_hash) {
        const tempPassword = 'worker123';
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        await pool.query('UPDATE workers SET password_hash = ? WHERE id = ?', [passwordHash, 'WKR-2026-0147']);
        console.log('✅ Default password set for worker WKR-2026-0147 (password: worker123)');
      }
    } catch (error) {
      console.log('⚠️ Could not set default password:', error.message);
    }
  } catch (error) {
    console.error('Schema setup error:', error);
  }
}

// Middleware
// Allow all origins for development (browser preview compatibility)
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
ensureSchema().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database config:`);
    console.log(`  Host: ${process.env.DB_HOST}`);
    console.log(`  Database: ${process.env.DB_NAME}`);
    console.log(`  User: ${process.env.DB_USER}`);
    console.log(`  Port: ${process.env.DB_PORT || 3306}`);
  });
  
  // Run expiry check immediately on startup
  checkExpiringWorkers().then(result => {
    console.log('Initial expiry check completed:', result);
  }).catch(err => {
    console.error('Initial expiry check failed:', err);
  });
  
  // Schedule expiry check to run every 24 hours
  setInterval(() => {
    checkExpiringWorkers().then(result => {
      console.log('Scheduled expiry check completed:', result);
    }).catch(err => {
      console.error('Scheduled expiry check failed:', err);
    });
  }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
