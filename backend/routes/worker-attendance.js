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

// Haversine distance in meters between two lat/lng points
const distanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Worker: Get today's attendance status
router.get('/today', requireAuth, requireWorker, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [attendance] = await pool.query(
      'SELECT * FROM attendance WHERE worker_id = ? AND date = ? ORDER BY id DESC LIMIT 1',
      [req.user.workerId, today]
    );

    // Phase E: expose visa-expired state so the dashboard can block check-in.
    // Applies only when a visa_expiry is on file AND today is on/after it.
    const [wrows] = await pool.query('SELECT visa_expiry FROM workers WHERE id = ?', [req.user.workerId]);
    const visaExpiry = wrows[0]?.visa_expiry;
    const visaExpired = Boolean(visaExpiry) && String(visaExpiry).slice(0, 10) <= today;

    if (attendance.length === 0) {
      return res.json({ checkedIn: false, record: null, visaExpired });
    }

    const record = attendance[0];
    const checkedIn = record.check_out_time === null;

    res.json({ checkedIn, record, visaExpired });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Worker: Check in
router.post('/checkin', requireAuth, requireWorker, async (req, res) => {
  try {
    const { location, latitude, longitude } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'Location is required' });
    }

    // Phase E: GPS position is required — the worker must enable location before
    // check-in (the frontend enforces this too; this blocks direct API calls).
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        error: 'Location access is required to check in. Please enable location services.'
      });
    }
    
    // Get worker details including expiry + visa status
    const [workers] = await pool.query('SELECT name, expiry, status, visa_expiry FROM workers WHERE id = ?', [req.user.workerId]);
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

    // Phase E: hard block on expired visa — legal requirement.
    // Only applies when a visa_expiry is on file and today is on/after it.
    const todayStr = today.toISOString().split('T')[0];
    if (worker.visa_expiry && String(worker.visa_expiry).slice(0, 10) <= todayStr) {
      return res.status(403).json({ error: 'Visa expired — check-in blocked. Please contact your administrator.' });
    }

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

    // Geofence check: compare the captured GPS against the selected location's
    // stored coordinates. Outside the radius → still allow check-in but flag it.
    let locationMismatch = 0;
    let dist = null;
    const [locRows] = await pool.query(
      'SELECT latitude, longitude, radius_meters FROM locations WHERE name = ?',
      [location]
    );
    const loc = locRows[0];
    if (loc && loc.latitude !== null && loc.longitude !== null) {
      const radius = loc.radius_meters ?? 200;
      dist = Math.round(distanceMeters(lat, lng, Number(loc.latitude), Number(loc.longitude)));
      if (dist > radius) locationMismatch = 1;
    }

    // Phase F: daily assignment check — compare the selected location against
    // today's assigned location (if any). Workers with no assignment → 'none'.
    let assignmentStatus = 'none';
    let assignedLocation = null;
    const [asgnRows] = await pool.query(
      `SELECT l.name AS location_name FROM worker_location_assignments a
       JOIN locations l ON l.id = a.location_id
       WHERE a.worker_id = ? AND a.assigned_date = ?`,
      [req.user.workerId, todayStr]
    );
    if (asgnRows.length > 0) {
      assignedLocation = asgnRows[0].location_name;
      assignmentStatus = assignedLocation === location ? 'match' : 'mismatch';
    }

    const attendanceId = generateAttendanceId();

    await pool.query(
      `INSERT INTO attendance
      (id, worker_id, worker, date, check_in_time, check_out_time, location, hours_worked, source,
       check_in_lat, check_in_lng, location_mismatch, assignment_status)
      VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 'Self', ?, ?, ?, ?)`,
      [attendanceId, req.user.workerId, worker.name, todayStr, timeIn, location,
       lat, lng, locationMismatch, assignmentStatus]
    );

    // Notify admin when the worker checks in at a different location than assigned
    if (assignmentStatus === 'mismatch') {
      try {
        await pool.query(
          `INSERT INTO notifications (id, worker, worker_id, message, urgency)
           VALUES (?, ?, ?, ?, ?)`,
          [`ASGN-${attendanceId}`, worker.name, req.user.workerId,
           `[Assignment] ${worker.name} checked in at ${location} but was assigned to ${assignedLocation} on ${todayStr}.`,
           'critical']
        );
      } catch (e) {
        console.error('Assignment mismatch notification failed:', e);
      }
    }

    res.status(201).json({
      id: attendanceId, timeIn, location,
      locationMismatch: locationMismatch === 1,
      distanceMeters: dist,
      assignmentStatus,
      assignedLocation,
      message: 'Checked in successfully'
    });
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
