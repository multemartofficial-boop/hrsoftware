const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');

// Worker login (by worker code)
router.post('/worker/login', async (req, res) => {
  try {
    const { workerCode, password } = req.body;

    if (!workerCode || !password) {
      return res.status(400).json({ error: 'Worker code and password are required' });
    }

    // Get worker from database
    const [workers] = await pool.query(
      'SELECT * FROM workers WHERE id = ?',
      [workerCode]
    );

    if (workers.length === 0) {
      return res.status(401).json({ error: 'Invalid worker code or password' });
    }

    const worker = workers[0];

    // Check if worker has password_hash
    if (!worker.password_hash) {
      return res.status(401).json({ error: 'No password set for this worker. Please use the setup link sent to your email.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, worker.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid worker code or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: worker.id,
        email: worker.email,
        name: worker.name,
        role: 'worker',
        workerId: worker.id
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: worker.id,
        email: worker.email,
        name: worker.name,
        role: 'worker',
        workerId: worker.id
      }
    });
  } catch (error) {
    console.error('Worker login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user from database
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];

    // Verify this is an admin account
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required. This endpoint is for admin accounts only.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workerId: user.worker_id
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workerId: user.worker_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get current user info
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role, worker_id FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    
    // If worker, get additional worker details
    if (user.role === 'worker' && user.worker_id) {
      const [workers] = await pool.query(
        'SELECT * FROM workers WHERE id = ?',
        [user.worker_id]
      );
      
      if (workers.length > 0) {
        return res.json({
          ...user,
          workerDetails: workers[0]
        });
      }
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Validate setup token (for frontend form validation)
router.get('/validate-setup-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "setup" AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired token' });
    }

    const tokenData = tokens[0];

    // Find the approved application
    const [applications] = await pool.query(
      'SELECT name, email, worker_id FROM registration_applications WHERE approval_token = ? AND status = "approved"',
      [token]
    );

    if (applications.length === 0) {
      return res.status(400).json({ valid: false, error: 'Invalid application or token' });
    }

    const application = applications[0];

    // Check if worker already exists
    const [existingWorkers] = await pool.query(
      'SELECT * FROM workers WHERE id = ?',
      [application.worker_id]
    );

    if (existingWorkers.length > 0) {
      return res.status(400).json({ valid: false, error: 'Worker account already exists' });
    }

    res.json({ 
      valid: true, 
      email: application.email,
      name: application.name,
      workerId: application.worker_id
    });
  } catch (error) {
    console.error('Validate token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Setup password using verification token
router.post('/setup-password', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const { token, password } = req.body;

    if (!token || !password) {
      await connection.rollback();
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      await connection.rollback();
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Find valid setup token
    const [tokens] = await connection.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "setup" AND used_at IS NULL AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const tokenData = tokens[0];

    // Find the approved application
    const [applications] = await connection.query(
      'SELECT * FROM registration_applications WHERE approval_token = ? AND status = "approved"',
      [token]
    );

    if (applications.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid application or token' });
    }

    const application = applications[0];

    // Check if worker already exists
    const [existingWorkers] = await connection.query(
      'SELECT * FROM workers WHERE id = ?',
      [application.worker_id]
    );

    if (existingWorkers.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Worker account already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create worker account
    await connection.query(
      `INSERT INTO workers 
      (id, name, phone, email, location, role, rate, joined, expiry, address, nid, status, password_hash) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [application.worker_id, application.name, application.phone, application.email, application.location,
       application.applied_for, application.rate, application.worker_joined, application.worker_expiry, 
       application.address, application.nid, passwordHash]
    );

    // Move related data from application to worker
    await connection.query(
      'UPDATE worker_previous_addresses SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [application.worker_id, application.id]
    );

    await connection.query(
      'UPDATE worker_employment_history SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [application.worker_id, application.id]
    );

    await connection.query(
      'UPDATE worker_referees SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [application.worker_id, application.id]
    );

    await connection.query(
      'UPDATE worker_qualifications SET worker_id = ?, application_id = NULL WHERE application_id = ?',
      [application.worker_id, application.id]
    );

    // Create user account for worker
    await connection.query(
      'INSERT INTO users (name, email, password_hash, role, worker_id) VALUES (?, ?, ?, "worker", ?)',
      [application.name, application.email, passwordHash, application.worker_id]
    );

    // Mark token as used
    await connection.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenData.id]
    );

    // Clear approval token from application
    await connection.query(
      'UPDATE registration_applications SET approval_token = NULL WHERE id = ?',
      [application.id]
    );

    await connection.commit();
    res.json({ 
      message: 'Password set successfully. You can now log in.',
      workerId: application.worker_id
    });
  } catch (error) {
    await connection.rollback();
    console.error('Setup password error:', error);
    res.status(500).json({ error: 'Server error during password setup' });
  } finally {
    connection.release();
  }
});

module.exports = router;
