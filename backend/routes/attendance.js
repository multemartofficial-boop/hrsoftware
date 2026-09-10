const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin, requireWorker } = require('../middleware/auth');
const { getHolidayAccrualRate, accrueHolidayHours } = require('../utils/holiday-accrual');

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

// Admin: Get all attendance records
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId, from, to } = req.query;
    
    let query = 'SELECT * FROM attendance';
    const params = [];
    const conditions = [];
    
    if (workerId && workerId !== 'all') {
      conditions.push('worker_id = ?');
      params.push(workerId);
    }
    
    if (from) {
      conditions.push('date >= ?');
      params.push(from);
    }
    
    if (to) {
      conditions.push('date <= ?');
      params.push(to);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY date DESC, check_in_time DESC';
    
    const [attendance] = await pool.query(query, params);
    res.json(attendance);
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: true, message: 'Failed to load attendance records' });
  }
});

// Worker: Get own attendance records
router.get('/my', requireAuth, requireWorker, async (req, res) => {
  try {
    const [attendance] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? ORDER BY date DESC',
      [req.user.workerId]
    );
    res.json(attendance);
  } catch (error) {
    console.error('Get my attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Add attendance entry
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId, date, in: timeIn, out: timeOut, location } = req.body;
    
    // Get worker name
    const [workers] = await pool.query('SELECT name FROM workers WHERE id = ?', [workerId]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    const finalTimeOut = timeOut || null;
    const hours = calculateHours(timeIn, finalTimeOut);
    const holidayAccrued = accrueHolidayHours(hours, await getHolidayAccrualRate());
    const attendanceId = generateAttendanceId();
    
    await pool.query(
      `INSERT INTO attendance 
      (id, worker_id, worker, date, check_in_time, check_out_time, location, hours_worked, holiday_accrued_hours, source) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Admin')`,
      [attendanceId, workerId, workers[0].name, date, timeIn, finalTimeOut, location, hours, holidayAccrued]
    );

    res.status(201).json({ id: attendanceId, hours, holidayAccruedHours: holidayAccrued, message: 'Attendance added successfully' });
  } catch (error) {
    console.error('Add attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Worker: Check in
router.post('/checkin', requireAuth, requireWorker, async (req, res) => {
  try {
    const { location } = req.body;
    
    // Get worker details
    const [workers] = await pool.query('SELECT name FROM workers WHERE id = ?', [req.user.workerId]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeIn = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Check if already checked in today
    const [existing] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? AND date = ? AND check_out_time IS NULL',
      [req.user.workerId, today]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Already checked in' });
    }
    
    // Store check-in in attendance with null check_out_time (we'll update on checkout)
    const attendanceId = generateAttendanceId();
    
    await pool.query(
      `INSERT INTO attendance 
      (id, worker_id, worker, date, check_in_time, check_out_time, location, hours_worked, source) 
      VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 'Self')`,
      [attendanceId, req.user.workerId, workers[0].name, today, timeIn, location]
    );

    res.json({ id: attendanceId, timeIn, location, message: 'Checked in successfully' });
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
    const holidayAccrued = accrueHolidayHours(hours, await getHolidayAccrualRate());
    
    // Update check-out time, hours and statutory holiday accrual
    await pool.query(
      'UPDATE attendance SET check_out_time = ?, hours_worked = ?, holiday_accrued_hours = ? WHERE id = ?',
      [timeOut, hours, holidayAccrued, record.id]
    );

    res.json({ hours, holidayAccruedHours: holidayAccrued, timeOut, message: 'Checked out successfully' });
  } catch (error) {
    console.error('Check out error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update attendance
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId, date, in: timeIn, out: timeOut, location } = req.body;
    
    // Get worker name if workerId changed
    const [workers] = await pool.query('SELECT name FROM workers WHERE id = ?', [workerId]);
    if (workers.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    
    const finalTimeOut = timeOut || null;
    const hours = calculateHours(timeIn, finalTimeOut);
    // Times changed, so the accrual is recomputed at the CURRENT configured rate
    const holidayAccrued = accrueHolidayHours(hours, await getHolidayAccrualRate());
    
    await pool.query(
      `UPDATE attendance 
      SET worker_id = ?, worker = ?, date = ?, check_in_time = ?, check_out_time = ?, 
          location = ?, hours_worked = ?, holiday_accrued_hours = ? 
      WHERE id = ?`,
      [workerId, workers[0].name, date, timeIn, finalTimeOut, location, hours, holidayAccrued, req.params.id]
    );

    res.json({ hours, holidayAccruedHours: holidayAccrued, message: 'Attendance updated successfully' });
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete attendance
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM attendance WHERE id = ?', [req.params.id]);
    res.json({ message: 'Attendance deleted successfully' });
  } catch (error) {
    console.error('Delete attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get currently checked-in workers (for admin dashboard)
router.get('/active/shifts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [activeShifts] = await pool.query(
      `SELECT a.*, w.address AS worker_address
       FROM attendance a
       LEFT JOIN workers w ON w.id = a.worker_id
       WHERE a.check_out_time IS NULL ORDER BY a.check_in_time DESC`
    );
    res.json(activeShifts);
  } catch (error) {
    console.error('Get active shifts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
