const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

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
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "setup" AND used_at IS NULL AND DATE(expires_at) > DATE(NOW())',
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
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "setup" AND used_at IS NULL AND DATE(expires_at) > DATE(NOW())',
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

// Request password reset (for both admin and worker)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email exists in users table (admin) or workers table (worker)
    const [users] = await pool.query(
      'SELECT id, name, email, role, worker_id FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      // Check workers table
      const [workers] = await pool.query(
        'SELECT id, name, email FROM workers WHERE email = ?',
        [email]
      );

      if (workers.length === 0) {
        // Don't reveal if email exists for security
        return res.json({ message: 'If an account exists with this email, a password reset link will be sent.' });
      }

      const worker = workers[0];
      await sendPasswordResetEmail(worker.email, worker.name, worker.id, 'worker');
    } else {
      const user = users[0];
      if (user.role === 'admin') {
        await sendPasswordResetEmail(user.email, user.name, user.id, 'admin');
      } else if (user.role === 'worker') {
        await sendPasswordResetEmail(user.email, user.name, user.worker_id, 'worker');
      }
    }

    res.json({ message: 'If an account exists with this email, a password reset link will be sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error during password reset request' });
  }
});

// Validate reset token
router.get('/validate-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "reset" AND used_at IS NULL AND DATE(expires_at) > DATE(NOW())',
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired token' });
    }

    const tokenData = tokens[0];

    res.json({ 
      valid: true, 
      email: tokenData.email,
      userType: tokenData.worker_id ? 'worker' : 'admin'
    });
  } catch (error) {
    console.error('Validate reset token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password using reset token
router.post('/reset-password', async (req, res) => {
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

    // Find valid reset token
    const [tokens] = await connection.query(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "reset" AND used_at IS NULL AND DATE(expires_at) > DATE(NOW())',
      [token]
    );

    if (tokens.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const tokenData = tokens[0];

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update password based on user type
    if (tokenData.worker_id) {
      // Worker reset
      await connection.query(
        'UPDATE workers SET password_hash = ? WHERE id = ?',
        [passwordHash, tokenData.worker_id]
      );

      // Also update users table
      await connection.query(
        'UPDATE users SET password_hash = ? WHERE worker_id = ?',
        [passwordHash, tokenData.worker_id]
      );
    } else {
      // Admin reset
      await connection.query(
        'UPDATE users SET password_hash = ? WHERE email = ?',
        [passwordHash, tokenData.email]
      );
    }

    // Mark token as used
    await connection.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenData.id]
    );

    await connection.commit();
    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (error) {
    await connection.rollback();
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error during password reset' });
  } finally {
    connection.release();
  }
});

// Helper function to send password reset email
async function sendPasswordResetEmail(email, name, userId, userType) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  // Invalidate any existing reset tokens for this email
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE email = ? AND token_type = "reset" AND used_at IS NULL',
    [email]
  );

  // Create new reset token
  await pool.query(
    'INSERT INTO password_reset_tokens (email, worker_id, token, token_type, expires_at) VALUES (?, ?, ?, "reset", ?)',
    [email, userType === 'worker' ? userId : null, token, expiresAt]
  );

  const resetLink = `http://localhost:8080/reset-password?token=${token}`;

  await sendEmail({
    to: email,
    subject: 'Password Reset Request',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hello ${name},</p>
      <p>You have requested to reset your password. Click the link below to set a new password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>This link will expire in 1 hour.</p>
      <p>If you did not request this, please ignore this email.</p>
    `,
    text: `Hello ${name}, You have requested to reset your password. Click the link below to set a new password: ${resetLink} This link will expire in 1 hour. If you did not request this, please ignore this email.`
  });
}

module.exports = router;
