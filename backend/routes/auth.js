const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { appBaseUrl } = require('../utils/app-url');

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

    // Get user from database (normalize: trim + lowercase so autofill/whitespace can't mismatch)
    const normalizedEmail = email.trim().toLowerCase();
    const [users] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [normalizedEmail]
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

// Client login (email + password against client-role user accounts)
router.post('/client/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [users] = await pool.query(
      `SELECT u.*, c.id AS client_id, c.company FROM users u
       JOIN clients c ON c.user_id = u.id
       WHERE u.email = ? AND u.role = 'client'`,
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: 'client',
        clientId: user.client_id
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
        role: 'client',
        clientId: user.client_id,
        company: user.company
      }
    });
  } catch (error) {
    console.error('Client login error:', error);
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
      // No worker application — check for a pending admin invite
      const [adminUsers] = await pool.query(
        'SELECT name, email FROM users WHERE email = ? AND role = "admin" AND password_hash = ""',
        [tokenData.email]
      );
      if (adminUsers.length > 0) {
        return res.json({
          valid: true,
          email: adminUsers[0].email,
          name: adminUsers[0].name,
          accountType: 'admin'
        });
      }
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
      // No worker application — this token may belong to an admin invite.
      const [adminUsers] = await connection.query(
        'SELECT * FROM users WHERE email = ? AND role = "admin" AND password_hash = ""',
        [tokenData.email]
      );

      if (adminUsers.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid application or token' });
      }

      const invitedAdmin = adminUsers[0];
      const passwordHash = await bcrypt.hash(password, 10);
      await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, invitedAdmin.id]);
      await connection.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [tokenData.id]);
      await connection.commit();

      // Emails outside the transaction — a mail failure must not undo the setup
      try {
        const loginLink = `${appBaseUrl(req)}/`;
        await sendEmail({
          to: invitedAdmin.email,
          subject: 'Your WorkHR admin account is ready',
          html: `
            <h2>Admin account activated!</h2>
            <p>Hi ${invitedAdmin.name},</p>
            <p>Your password has been set and your WorkHR admin account is now active.</p>
            <p>You can now log in using your email and password:</p>
            <p><a href="${loginLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Log In</a></p>
          `,
          text: `Your WorkHR admin account is now active. Log in at: ${loginLink}`
        });
        const [otherAdmins] = await pool.query(
          'SELECT email FROM users WHERE role = "admin" AND password_hash <> "" AND id <> ?',
          [invitedAdmin.id]
        );
        const emails = otherAdmins.map(a => a.email).filter(Boolean);
        if (emails.length > 0) {
          await sendEmail({
            to: emails.join(', '),
            subject: `New admin joined: ${invitedAdmin.name}`,
            html: `
              <h2>New admin account activated</h2>
              <p><strong>${invitedAdmin.name}</strong> (${invitedAdmin.email}) has set their password and is now an active WorkHR administrator.</p>
            `,
            text: `${invitedAdmin.name} (${invitedAdmin.email}) completed admin setup and is now active.`
          });
        }
      } catch (notifyError) {
        console.error('Admin setup notification error:', notifyError);
      }

      return res.json({ message: 'Password set successfully. You can now log in.', accountType: 'admin' });
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

    // Create worker account. Passport / visa / SIA details are carried over from the
    // application so later phases (visa & SIA expiry warnings) can use them.
    // Pay type (Part 2): salaried workers get monthly_salary and rate 0;
    // hourly workers get the confirmed rate and no salary.
    const appPayType = application.pay_type === 'salary' ? 'salary' : 'hourly';
    await connection.query(
      `INSERT INTO workers
      (id, name, phone, email, location, role, rate, pay_type, monthly_salary, joined, expiry, address, nid, status, password_hash,
       passport_country, passport_number, passport_expiry,
       visa_number, visa_expiry, sia_badge_number, sia_badge_expiry,
       worker_type, subcontract_company, employment_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [application.worker_id, application.name, application.phone, application.email, application.location,
       application.applied_for, appPayType === 'salary' ? 0 : application.rate,
       appPayType, appPayType === 'salary' ? (Number(application.monthly_salary) || null) : null,
       application.worker_joined, application.worker_expiry,
       application.address, application.nid, passwordHash,
       application.passport_country || null, application.passport_number || null, application.passport_expiry || null,
       application.visa_number || null, application.visa_expiry || null,
       application.sia_badge_number || null, application.sia_badge_expiry || null,
       application.worker_type || 'Direct', application.subcontract_company || null,
       application.employment_type === 'full_time' ? 'full_time' : 'irregular']
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

    // Post-setup emails + admin notification — failures here must not undo the
    // account creation, so they are handled outside the transaction.
    try {
      const loginLink = `${appBaseUrl(req)}/`;

      // 1. Success confirmation to the worker
      await sendEmail({
        to: application.email,
        subject: `Your WorkHR account is ready - ${application.worker_id}`,
        html: `
          <h2>Account setup complete!</h2>
          <p>Hi ${application.name},</p>
          <p>Your password has been set and your worker account is now active.</p>
          <p><strong>Worker Code:</strong> ${application.worker_id}</p>
          <p>You can now log in to your Worker Dashboard using your worker code and password:</p>
          <p><a href="${loginLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Log In</a></p>
        `,
        text: `Your WorkHR account is active. Worker Code: ${application.worker_id}. Log in at: ${loginLink}`
      });

      // 2. New-registration notice to every admin
      const [admins] = await pool.query('SELECT email FROM users WHERE role = "admin" AND email IS NOT NULL');
      const adminEmails = admins.map(a => a.email).filter(Boolean);
      if (adminEmails.length > 0) {
        await sendEmail({
          to: adminEmails.join(', '),
          subject: `New worker registration completed: ${application.name} (${application.worker_id})`,
          html: `
            <h2>New worker registration completed</h2>
            <p><strong>${application.name}</strong> has set their password and their worker account is now active.</p>
            <p><strong>Worker Code:</strong> ${application.worker_id}</p>
            <p><strong>Email:</strong> ${application.email}</p>
            <p><strong>Role:</strong> ${application.applied_for || '-'}</p>
            <p><strong>Location:</strong> ${application.location || '-'}</p>
          `,
          text: `${application.name} (${application.worker_id}) completed registration and their account is now active.`
        });
      }

      // 3. In-app admin notification (deferred from approval — the worker row exists now)
      await pool.query(
        'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "info", "Just now")',
        [`N-REG-${application.worker_id}`, application.name, application.worker_id,
         `${application.name} completed registration — worker account ${application.worker_id} is now active.`]
      );
    } catch (notifyError) {
      console.error('Post-setup notification error:', notifyError);
    }

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
    const email = (req.body.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    console.log(`[forgot-password] Request received for: ${email}`);

    // Check if email exists in users table (admin) or workers table (worker)
    const [users] = await pool.query(
      'SELECT id, name, email, role, worker_id FROM users WHERE LOWER(email) = ?',
      [email]
    );

    if (users.length === 0) {
      // Check workers table
      const [workers] = await pool.query(
        'SELECT id, name, email FROM workers WHERE LOWER(email) = ?',
        [email]
      );

      if (workers.length === 0) {
        // Don't reveal if email exists for security (client still gets generic success)
        console.warn(`[forgot-password] No account found for ${email} - no token created, no email sent`);
        return res.json({ message: 'If an account exists with this email, a password reset link will be sent.' });
      }

      const worker = workers[0];
      console.log(`[forgot-password] Matched worker ${worker.id} (${worker.name}) in workers table`);
      await sendPasswordResetEmail(worker.email, worker.name, worker.id, 'worker', req);
    } else {
      const user = users[0];
      console.log(`[forgot-password] Matched users row id=${user.id} role=${user.role} worker_id=${user.worker_id}`);
      if (user.role === 'admin' || user.role === 'client') {
        // Clients live in the users table like admins — same reset path
        await sendPasswordResetEmail(user.email, user.name, user.id, 'admin', req);
      } else if (user.role === 'worker') {
        await sendPasswordResetEmail(user.email, user.name, user.worker_id, 'worker', req);
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
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "reset" AND used_at IS NULL AND expires_at > NOW()',
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
      'SELECT * FROM password_reset_tokens WHERE token = ? AND token_type = "reset" AND used_at IS NULL AND expires_at > NOW()',
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
async function sendPasswordResetEmail(email, name, userId, userType, req) {
  const token = crypto.randomBytes(32).toString('hex');
  // Use UTC timestamp to match database timezone
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

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

  const resetLink = `${appBaseUrl(req)}/reset-password?token=${token}`;

  const result = await sendEmail({
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

  if (result.success) {
    console.log(`[forgot-password] Reset email sent via ${result.method} to ${email} (${userType})`);
  } else {
    console.error(`[forgot-password] Reset email NOT delivered to ${email} (${userType}) - method=${result.method}${result.error ? ` error=${result.error}` : ''}`);
  }
  return result;
}

module.exports = router;
