const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Generate notification ID
const generateNotificationId = () => {
  return `N-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

// Helper: Calculate days until expiry
const daysUntil = (date) => {
  const today = new Date();
  const expiry = new Date(date);
  const diffTime = expiry - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Helper: Format date for display
const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

// Admin: Get all notifications
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [notifications] = await pool.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'
    );
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: true, message: 'Failed to load notifications' });
  }
});

// Admin: Get expiry notices
router.get('/expiry', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settingsData = settings[0] || {};

    const [workers] = await pool.query('SELECT * FROM workers WHERE status = "active"');
    const expiryNotices = [];

    for (const worker of workers) {
      const daysLeft = daysUntil(worker.expiry);
      
      if (daysLeft <= (settingsData.first_reminder_days || 30)) {
        const urgency = daysLeft <= (settingsData.final_reminder_days || 7) ? 'critical' : 'warning';
        const message = daysLeft < 0 
          ? `Contract expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago (${formatDate(worker.expiry)})`
          : `Contract expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${formatDate(worker.expiry)})`;

        expiryNotices.push({
          id: `EXP-${worker.id}`,
          worker: worker.name,
          workerId: worker.id,
          message,
          urgency,
          occurred_at: formatDate(worker.expiry),
          category: 'contract'
        });
      }

      // Visa expiry alerts (Phase E): 90-day window, separate from contract expiry
      if (worker.visa_expiry) {
        const visaDays = daysUntil(worker.visa_expiry);
        if (visaDays <= 90) {
          const visaUrgency = visaDays <= 7 ? 'critical' : 'warning';
          const visaMessage = visaDays < 0
            ? `Visa EXPIRED ${Math.abs(visaDays)} day${Math.abs(visaDays) === 1 ? '' : 's'} ago — cannot legally continue working, action required`
            : `Visa expires in ${visaDays} day${visaDays === 1 ? '' : 's'} — expired visas cannot legally continue working, action required`;
          expiryNotices.push({
            id: `VISA-${worker.id}`,
            worker: worker.name,
            workerId: worker.id,
            message: visaMessage,
            urgency: visaUrgency,
            occurred_at: formatDate(worker.visa_expiry),
            category: 'visa'
          });
        }
      }
    }

    res.json(expiryNotices);
  } catch (error) {
    console.error('Get expiry notices error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get activity log
router.get('/activity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [activity] = await pool.query(
      'SELECT * FROM notifications WHERE urgency = "info" ORDER BY created_at DESC LIMIT 20'
    );
    res.json(activity);
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Create notification
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { worker, workerId, message, urgency } = req.body;
    const notificationId = generateNotificationId();
    
    await pool.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, ?, "Just now")',
      [notificationId, worker, workerId, message, urgency || 'info']
    );

    res.status(201).json({ id: notificationId, message: 'Notification created successfully' });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete notification
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
