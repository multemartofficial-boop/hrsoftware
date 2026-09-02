const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireWorker } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

// Helper: Calculate hours between time strings
const calculateHours = (timeIn, timeOut) => {
  if (!timeIn || !timeOut) {
    console.error('Missing time values:', { timeIn, timeOut });
    return 0;
  }
  
  const [inHours, inMinutes] = timeIn.split(':').map(Number);
  const [outHours, outMinutes] = timeOut.split(':').map(Number);
  
  const inDate = new Date();
  inDate.setHours(inHours, inMinutes, 0, 0);
  
  const outDate = new Date();
  outDate.setHours(outHours, outMinutes, 0, 0);
  
  const diffMs = outDate - inDate;
  return Math.max(0, diffMs / (1000 * 60 * 60)); // Return positive hours
};

// Generate attendance ID
const generateAttendanceId = () => {
  return `ATT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
};

// Worker: Get today's attendance status
router.get('/today', requireAuth, requireWorker, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const [attendance] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? AND date = ? ORDER BY id DESC LIMIT 1',
      [req.user.workerId, today]
    );
    
    if (attendance.length === 0) {
      return res.json({ checkedIn: false, record: null });
    }
    
    const record = attendance[0];
    const checkedIn = record.check_out_time === null;
    
    res.json({ checkedIn, record });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Worker: Check in
router.post('/checkin', requireAuth, requireWorker, async (req, res) => {
  try {
    const { location } = req.body;
    
    if (!location) {
      return res.status(400).json({ error: 'Location is required' });
    }
    
    // Get worker details including expiry status
    const [workers] = await pool.query('SELECT name, expiry, status FROM workers WHERE id = ?', [req.user.workerId]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    const worker = workers[0];
    
    // Check if worker is expired
    const today = new Date();
    const expiryDate = new Date(worker.expiry);
    
    if (today > expiryDate || worker.status === 'expired') {
      return res.status(403).json({ error: 'Your account has expired, please contact admin' });
    }
    
    const todayStr = today.toISOString().split('T')[0];
    const now = new Date();
    const timeIn = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Check if already checked in today
    const [existing] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? AND date = ? AND check_out_time IS NULL',
      [req.user.workerId, todayStr]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Already checked in' });
    }
    
    const attendanceId = generateAttendanceId();
    
    await pool.query(
      `INSERT INTO attendance 
      (id, worker_id, worker, date, check_in_time, check_out_time, location, hours_worked, source) 
      VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 'Self')`,
      [attendanceId, req.user.workerId, worker.name, todayStr, timeIn, location]
    );

    res.status(201).json({ id: attendanceId, timeIn, location, message: 'Checked in successfully' });
  } catch (error) {
    console.error('Check in error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Worker: Check out
router.post('/checkout', requireAuth, requireWorker, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeOut = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Get today's check-in record
    const [attendance] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? AND date = ? AND check_out_time IS NULL',
      [req.user.workerId, today]
    );
    
    if (attendance.length === 0) {
      return res.status(400).json({ error: 'No active check-in found' });
    }
    
    const record = attendance[0];
    const hours = calculateHours(record.check_in_time, timeOut);
    
    // Validate hours is a finite number
    if (!Number.isFinite(hours)) {
      return res.status(500).json({ error: 'Invalid hours calculation' });
    }
    
    // Update check-out time and hours
    await pool.query(
      'UPDATE attendance SET check_out_time = ?, hours_worked = ? WHERE id = ?',
      [timeOut, hours, record.id]
    );

    res.json({ hours: Math.round(hours * 100) / 100, timeOut, message: 'Checked out successfully' });
  } catch (error) {
    console.error('Check out error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Worker: Get own attendance history
router.get('/my', requireAuth, requireWorker, async (req, res) => {
  try {
    const [attendance] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? ORDER BY date DESC, check_in_time DESC',
      [req.user.workerId]
    );
    res.json(attendance);
  } catch (error) {
    console.error('Get my attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
