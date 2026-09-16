const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');
const { appBaseUrl } = require('../utils/app-url');
const { logActionFromReq } = require('../utils/action-log');

// An invited admin has an empty password_hash until they complete setup —
// bcrypt.compare never matches an empty hash, so they cannot log in early.
const INVITE_EXPIRY_HOURS = 48;

const createInviteToken = async (connection, email) => {
  // Invalidate any previous invite tokens for this email
  await connection.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE email = ? AND token_type = "setup" AND used_at IS NULL',
    [email]
  );
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setHours(expires.getHours() + INVITE_EXPIRY_HOURS);
  await connection.query(
    'INSERT INTO password_reset_tokens (email, worker_id, token, token_type, expires_at) VALUES (?, NULL, ?, "setup", ?)',
    [email, token, expires.toISOString().slice(0, 19).replace('T', ' ')]
  );
  return token;
};

const sendInviteEmail = async ({ email, name, note, invitedBy, token, baseUrl }) => {
  const setupLink = `${baseUrl}/setup-password?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'You have been invited as an admin - WorkHR',
    html: `
      <h2>Admin invitation</h2>
      <p>Hi ${name},</p>
      <p>${invitedBy ? `<strong>${invitedBy}</strong> has` : 'You have been'} invited you to join WorkHR as an <strong>administrator</strong>.</p>
      ${note ? `<p><em>"${note}"</em></p>` : ''}
      <p>To set your password and activate your admin account, click the link below:</p>
      <p><a href="${setupLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Set Up Your Password</a></p>
      <p>This link will expire in ${INVITE_EXPIRY_HOURS} hours.</p>
      <p>If you were not expecting this invitation, please ignore this email.</p>
    `,
    text: `You have been invited to join WorkHR as an administrator. Set your password at: ${setupLink}`,
  });
};

// List all admin accounts (active + invited)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, note, created_at,
              (password_hash IS NOT NULL AND password_hash <> '') AS active
       FROM users WHERE role = 'admin' ORDER BY created_at ASC`
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, email: r.email, note: r.note,
      createdAt: r.created_at, status: r.active ? 'active' : 'invited',
      isSelf: r.id === req.user.userId,
    })));
  } catch (e) {
    console.error('List admins error:', e);
    res.status(500).json({ error: 'Failed to load admins' });
  }
});

// Invite a new admin: creates the user (no password yet) + emails a setup link
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const note = (req.body.note || '').trim() || null;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

    const [existing] = await connection.query('SELECT id, role FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: `A ${existing[0].role} account with this email already exists` });
    }

    await connection.beginTransaction();
    const [result] = await connection.query(
      'INSERT INTO users (name, email, password_hash, role, note) VALUES (?, ?, "", "admin", ?)',
      [name, email, note]
    );
    const token = await createInviteToken(connection, email);
    await connection.commit();

    await sendInviteEmail({ email, name, note, invitedBy: req.user.name, token, baseUrl: appBaseUrl(req) });
    await logActionFromReq(req, 'invited_admin', 'user', String(result.insertId), { name, email });
    res.status(201).json({ id: result.insertId, name, email, note, status: 'invited', message: 'Invitation sent' });
  } catch (e) {
    await connection.rollback();
    console.error('Invite admin error:', e);
    res.status(500).json({ error: 'Failed to invite admin' });
  } finally {
    connection.release();
  }
});

// Resend the invitation (only while setup is incomplete)
router.post('/:id/resend-invite', requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT * FROM users WHERE id = ? AND role = "admin"', [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found' });
    const admin = rows[0];
    if (admin.password_hash) return res.status(400).json({ error: 'This admin has already completed setup' });

    await connection.beginTransaction();
    const token = await createInviteToken(connection, admin.email);
    await connection.commit();

    await sendInviteEmail({ email: admin.email, name: admin.name, note: admin.note, invitedBy: req.user.name, token, baseUrl: appBaseUrl(req) });
    await logActionFromReq(req, 'resent_admin_invite', 'user', String(admin.id), { name: admin.name, email: admin.email });
    res.json({ message: 'Invitation resent' });
  } catch (e) {
    await connection.rollback();
    console.error('Resend admin invite error:', e);
    res.status(500).json({ error: 'Failed to resend invitation' });
  } finally {
    connection.release();
  }
});

// Remove an admin (cannot remove yourself or the last active admin)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.userId) return res.status(400).json({ error: 'You cannot remove your own account' });

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? AND role = "admin"', [targetId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found' });

    const [[{ n }]] = await pool.query(
      'SELECT COUNT(*) AS n FROM users WHERE role = "admin" AND password_hash <> "" AND id <> ?', [targetId]
    );
    if (n === 0) return res.status(400).json({ error: 'Cannot remove the last active admin' });

    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE email = ? AND used_at IS NULL', [rows[0].email]);
    await pool.query('DELETE FROM users WHERE id = ?', [targetId]);
    await logActionFromReq(req, 'removed_admin', 'user', String(targetId), { name: rows[0].name, email: rows[0].email });
    res.json({ message: 'Admin removed' });
  } catch (e) {
    console.error('Remove admin error:', e);
    res.status(500).json({ error: 'Failed to remove admin' });
  }
});

module.exports = router;
