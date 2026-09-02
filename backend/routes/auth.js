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
      return res.status(401).json({ error: 'No password set for this worker. Please contact admin.' });
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

module.exports = router;
