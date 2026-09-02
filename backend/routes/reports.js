const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Helper: Format date for display
const formatDate = (date) => {
  return new Date(date).toISOString().split('T')[0];
};

// Helper: Get week start date
const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(d.setDate(diff));
  return formatDate(weekStart);
};

// Admin: Get dashboard statistics
router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get settings
    const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settingsData = settings[0] || {};

    // Get active workers
    const [activeWorkers] = await pool.query(
      'SELECT COUNT(*) as count FROM workers WHERE expiry >= CURDATE() AND on_leave = false'
    );

    // Get expiring soon workers
    const [expiringSoon] = await pool.query(
      `SELECT COUNT(*) as count FROM workers 
      WHERE expiry <= DATE_ADD(CURDATE(), INTERVAL ? DAY) 
      AND expiry >= CURDATE() 
      AND on_leave = false`,
      [settingsData.first_reminder_days || 30]
    );

    // Get pending applications
    const [pendingApps] = await pool.query(
      'SELECT COUNT(*) as count FROM registration_applications WHERE status = "pending"'
    );

    // Get total payroll cost
    const [payrollCost] = await pool.query(
      'SELECT SUM(gross) as total FROM payroll'
    );

    // Get total hours worked
    const [totalHours] = await pool.query(
      'SELECT SUM(hours_worked) as total FROM attendance'
    );

    // Get labour cost
    const [labourCost] = await pool.query(
      `SELECT SUM(a.hours_worked * w.rate) as total 
      FROM attendance a 
      JOIN workers w ON a.worker_id = w.id`
    );

    // Get billing
    const billing = (labourCost[0].total || 0) * (settingsData.billing_multiplier || 1.45);
    const profit = billing - (labourCost[0].total || 0);

    res.json({
      activeWorkers: activeWorkers[0].count || 0,
      expiringSoon: expiringSoon[0].count || 0,
      pendingApplications: pendingApps[0].count || 0,
      payrollCost: payrollCost[0].total || 0,
      totalHours: totalHours[0].total || 0,
      labourCost: labourCost[0].total || 0,
      billing,
      profit
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: true, message: 'Failed to load dashboard statistics' });
  }
});

// Admin: Get weekly report
router.get('/weekly', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { location } = req.query;
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settingsData = settings[0] || {};

    // Generate last 6 weeks
    const weeks = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - (i * 7));
      const weekStart = getWeekStart(date);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      weeks.push({
        weekStart,
        weekEnd: formatDate(weekEnd),
        label: weekStart
      });
    }

    const report = [];
    for (const week of weeks) {
      let query = `
        SELECT SUM(a.hours_worked) as hours, 
               SUM(a.hours_worked * w.rate) as cost 
        FROM attendance a 
        JOIN workers w ON a.worker_id = w.id 
        WHERE a.date >= ? AND a.date <= ?
      `;
      const params = [week.weekStart, week.weekEnd];

      if (location && location !== 'all') {
        query += ' AND a.location = ?';
        params.push(location);
      }

      const [result] = await pool.query(query, params);
      const hours = result[0].hours || 0;
      const cost = result[0].cost || 0;
      const billing = cost * (settingsData.billing_multiplier || 1.45);

      report.push({
        week: weeks.indexOf(week) + 1,
        label: week.label,
        hours: Math.round(hours * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        billing: Math.round(billing * 100) / 100,
        profit: Math.round((billing - cost) * 100) / 100
      });
    }

    res.json(report);
  } catch (error) {
    console.error('Get weekly report error:', error);
    res.status(500).json({ error: true, message: 'Failed to load weekly report' });
  }
});

// Admin: Get location-based report
router.get('/by-location', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settingsData = settings[0] || {};

    const [locations] = await pool.query('SELECT * FROM locations ORDER BY name');
    const report = [];

    for (const location of locations) {
      const [result] = await pool.query(
        `SELECT SUM(a.hours_worked) as hours, 
                SUM(a.hours_worked * w.rate) as cost 
        FROM attendance a 
        JOIN workers w ON a.worker_id = w.id 
        WHERE a.location = ?`,
        [location.name]
      );

      const hours = result[0].hours || 0;
      const cost = result[0].cost || 0;
      const billing = cost * (settingsData.billing_multiplier || 1.45);

      report.push({
        name: location.name,
        hours: Math.round(hours * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        billing: Math.round(billing * 100) / 100,
        profit: Math.round((billing - cost) * 100) / 100
      });
    }

    res.json(report);
  } catch (error) {
    console.error('Get location report error:', error);
    res.status(500).json({ error: true, message: 'Failed to load location report' });
  }
});

// Admin: Get payroll chart data
router.get('/payroll-chart', requireAuth, requireAdmin, async (req, res) => {
  try {
    const chart = [];
    
    // Generate last 9 months
    for (let i = 8; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      date.setDate(1);
      
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
      
      const [result] = await pool.query(
        `SELECT SUM(gross) as cost, SUM(tax_ni + advance_deduction) as expense 
        FROM payroll 
        WHERE DATE_FORMAT(generated_at, '%Y-%m') = ?`,
        [key]
      );

      chart.push({
        key,
        month: monthNames[date.getMonth()],
        cost: Math.round((result[0].cost || 0) * 100) / 100,
        expense: Math.round((result[0].expense || 0) * 100) / 100
      });
    }

    res.json(chart);
  } catch (error) {
    console.error('Get payroll chart error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get deductions data
router.get('/deductions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const settingsData = settings[0] || {};

    const [advances] = await pool.query('SELECT SUM(advance_deduction) as total FROM payroll');
    const [tax] = await pool.query('SELECT SUM(tax_ni) as total FROM payroll');
    const [gross] = await pool.query('SELECT SUM(gross) as total FROM payroll');
    
    const pension = (gross[0].total || 0) * ((settingsData.pension_rate || 5) / 100);

    res.json([
      { name: 'Advances', value: Math.round((advances[0].total || 0) * 100) / 100 },
      { name: 'Tax & NI', value: Math.round((tax[0].total || 0) * 100) / 100 },
      { name: 'Pension', value: Math.round(pension * 100) / 100 }
    ]);
  } catch (error) {
    console.error('Get deductions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
