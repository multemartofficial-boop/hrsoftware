const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { checkExpiringWorkers } = require('../utils/expiry');

// Admin: Manual expiry check (for testing)
router.post('/check', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await checkExpiringWorkers();
    res.json({ 
      message: 'Expiry check completed',
      ...result
    });
  } catch (error) {
    console.error('Manual expiry check error:', error);
    res.status(500).json({ error: 'Server error during expiry check' });
  }
});

module.exports = router;