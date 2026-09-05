const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Generate payroll ID
const generatePayrollId = () => {
  return `PYRL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

// Helper: Calculate payroll
const calculatePayroll = async (workerId, from, to, advance, settings, { allowZeroHours = false } = {}) => {
  // Get worker details
  const [workers] = await pool.query('SELECT * FROM workers WHERE id = ?', [workerId]);
  if (workers.length === 0) {
    throw new Error('Worker not found');
  }
  
  const worker = workers[0];
  // Convert rate from string to number
  const rate = Number(worker.rate) || 0;
  
  // Get total hours in period
  const [attendance] = await pool.query(
    'SELECT SUM(hours_worked) as total_hours FROM attendance WHERE worker_id = ? AND date >= ? AND date <= ?',
    [workerId, from, to]
  );
  
  const totalHours = Number(attendance[0].total_hours) || 0;
  
  // Validate: if no attendance records, return early with a clear error
  if (totalHours === 0 && !allowZeroHours) {
    throw new Error('No attendance records found for this worker in the selected date range');
  }
  
  // Convert settings from strings to numbers
  const overtimeThreshold = Number(settings.overtime_threshold) || 40;
  const overtimeMultiplier = Number(settings.overtime_multiplier) || 1.5;
  const taxRateValue = Number(settings.tax_rate) || 0;
  const niRateValue = Number(settings.ni_rate) || 0;
  
  // Calculate overtime
  const weeks = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / (7 * 24 * 60 * 60 * 1000)));
  const normalHours = Math.min(totalHours, overtimeThreshold * weeks);
  const overtimeHours = Math.max(0, totalHours - normalHours);
  
  // Calculate amounts
  const gross = (normalHours * rate) + (overtimeHours * rate * overtimeMultiplier);
  const taxRatePercent = (taxRateValue + niRateValue) / 100;
  const tax = gross * taxRatePercent;
  const net = gross - tax - advance;
  
  // Validate all values are finite numbers
  if (!Number.isFinite(gross) || !Number.isFinite(tax) || !Number.isFinite(net)) {
    throw new Error('Invalid calculation results: gross, tax, or net pay is not a valid number');
  }
  
  return {
    workerId,
    worker: worker.name,
    rate,
    hours: totalHours,
    overtime: overtimeHours,
    gross: Math.round(gross * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    advance: Math.round(advance * 100) / 100,
    net: Math.round(net * 100) / 100,
    from,
    to
  };
};

// Admin: Get all payroll records
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, workerId } = req.query;
    
    let query = 'SELECT * FROM payroll';
    const params = [];
    const conditions = [];
    
    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (workerId) {
      conditions.push('worker_id = ?');
      params.push(workerId);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY generated_at DESC';
    
    const [payrolls] = await pool.query(query, params);
    
    // Normalize snake_case to camelCase for frontend compatibility
    const normalizedPayrolls = payrolls.map(p => ({
      id: p.id,
      workerId: p.worker_id,
      worker: p.worker,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      hours: Number(p.hours),
      overtime: Number(p.overtime),
      rate: Number(p.rate),
      gross: Number(p.gross),
      advanceDeduction: Number(p.advance_deduction),
      taxNi: Number(p.tax_ni),
      netPay: Number(p.net_pay),
      status: p.status,
      generatedAt: p.generated_at
    }));
    
    res.json(normalizedPayrolls);
  } catch (error) {
    console.error('Get payrolls error:', error);
    res.status(500).json({ error: true, message: 'Failed to load payroll records' });
  }
});

// Admin: Preview payroll calculation
router.post('/preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId, from, to, advance } = req.body;
    
    // Get settings
    const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (settings.length === 0) {
      return res.status(500).json({ error: 'Settings not configured' });
    }
    
    // Preview uses the exact same calculation as generation, but returns zeros instead of
    // erroring when there is no attendance so the modal can warn the admin before generating.
    const preview = await calculatePayroll(workerId, from, to, Number(advance) || 0, settings[0], { allowZeroHours: true });
    res.json(preview);
  } catch (error) {
    console.error('Preview payroll error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Admin: Generate payroll
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workerId, from, to, advance } = req.body;
    
    // Get settings
    const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (settings.length === 0) {
      return res.status(500).json({ error: 'Settings not configured' });
    }
    
    const calculation = await calculatePayroll(workerId, from, to, advance || 0, settings[0]);
    const payrollId = generatePayrollId();
    
    // Validate all numeric values before insertion
    const numericValues = {
      hours: calculation.hours,
      overtime: calculation.overtime,
      rate: calculation.rate,
      gross: calculation.gross,
      advance: calculation.advance,
      tax: calculation.tax,
      net: calculation.net
    };
    
    for (const [key, value] of Object.entries(numericValues)) {
      if (!Number.isFinite(value)) {
        console.error(`Invalid numeric value for ${key}:`, value);
        return res.status(400).json({ error: `Invalid ${key} value: ${value}` });
      }
    }
    
    await pool.query(
      `INSERT INTO payroll 
      (id, worker_id, worker, period_start, period_end, hours, overtime, rate, gross, advance_deduction, tax_ni, net_pay, status, generated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())`,
      [payrollId, calculation.workerId, calculation.worker, calculation.from, calculation.to,
       calculation.hours, calculation.overtime, calculation.rate, calculation.gross,
       calculation.advance, calculation.tax, calculation.net]
    );

    // Log notification
    await pool.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "info", "Just now")',
      [`N-${Date.now()}`, calculation.worker, calculation.workerId, `Payroll ${payrollId} generated`]
    );

    res.status(201).json({ id: payrollId, ...calculation, message: 'Payroll generated successfully' });
  } catch (error) {
    console.error('Generate payroll error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Admin: Update payroll status
router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['Pending', 'Completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await pool.query(
      'UPDATE payroll SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    res.json({ message: 'Payroll status updated successfully' });
  } catch (error) {
    console.error('Update payroll status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete payroll
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM payroll WHERE id = ?', [req.params.id]);
    res.json({ message: 'Payroll deleted successfully' });
  } catch (error) {
    console.error('Delete payroll error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get aggregated payroll summary by period (weekly/monthly/yearly)
// Read-only: computes live from attendance + worker rates, same tax/NI/overtime
// logic as calculatePayroll. No payroll records are created.
router.get('/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { period } = req.query; // 'weekly' | 'monthly' | 'yearly'
    if (!['weekly', 'monthly', 'yearly'].includes(period)) {
      return res.status(400).json({ error: 'period must be weekly, monthly, or yearly' });
    }

    const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (settings.length === 0) {
      return res.status(500).json({ error: 'Settings not configured' });
    }
    const s = settings[0];
    const overtimeThreshold = Number(s.overtime_threshold) || 40;
    const overtimeMultiplier = Number(s.overtime_multiplier) || 1.5;
    const taxRateValue = Number(s.tax_rate) || 0;
    const niRateValue = Number(s.ni_rate) || 0;
    const taxRatePercent = (taxRateValue + niRateValue) / 100;

    // Fetch all attendance joined with worker rates
    const [rows] = await pool.query(
      `SELECT a.worker_id, w.name AS worker_name, w.rate,
              a.date, a.hours_worked
       FROM attendance a
       JOIN workers w ON a.worker_id = w.id
       ORDER BY a.date`
    );

    // Determine period key for grouping
    const periodKey = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00');
      if (period === 'yearly') return String(d.getFullYear());
      if (period === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      // weekly: ISO week (Mon-Sun) — find Monday of the week
      const day = (d.getDay() + 6) % 7; // 0=Mon
      const monday = new Date(d);
      monday.setDate(d.getDate() - day);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = (x) => x.toISOString().slice(0, 10);
      return `${fmt(monday)}_${fmt(sunday)}`;
    };

    const periodLabel = (key) => {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      if (period === 'yearly') return key;
      if (period === 'monthly') {
        const [y, m] = key.split('-');
        return `${months[parseInt(m) - 1]} ${y}`;
      }
      // weekly: "DD Mon – DD Mon YYYY"
      const [start, end] = key.split('_');
      const f = (iso) => {
        const d = new Date(iso + 'T00:00:00');
        return `${d.getDate()} ${months[d.getMonth()]}`;
      };
      const y = new Date(start + 'T00:00:00').getFullYear();
      return `${f(start)} – ${f(end)} ${y}`;
    };

    // Group attendance by period, then by worker
    const groups = {};
    for (const row of rows) {
      const dateStr = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date);
      const pk = periodKey(dateStr);
      if (!groups[pk]) groups[pk] = { label: periodLabel(pk), workers: {} };
      if (!groups[pk].workers[row.worker_id]) {
        groups[pk].workers[row.worker_id] = {
          workerId: row.worker_id,
          worker: row.worker_name,
          rate: Number(row.rate) || 0,
          hours: 0,
        };
      }
      groups[pk].workers[row.worker_id].hours += Number(row.hours_worked) || 0;
    }

    // Calculate payroll figures per worker per period, then aggregate
    const result = Object.entries(groups).map(([key, group]) => {
      // Weeks used for overtime threshold calculation (same formula as calculatePayroll)
      const weeks = period === 'weekly' ? 1
        : period === 'monthly' ? Math.max(1, Math.ceil(30 / 7))
        : 52;

      let totalHours = 0, totalGross = 0, totalTax = 0, totalNet = 0;
      const workerBreakdown = Object.values(group.workers).map((w) => {
        const normalHours = Math.min(w.hours, overtimeThreshold * weeks);
        const overtimeHours = Math.max(0, w.hours - normalHours);
        const gross = (normalHours * w.rate) + (overtimeHours * w.rate * overtimeMultiplier);
        const tax = gross * taxRatePercent;
        const net = gross - tax;
        totalHours += w.hours;
        totalGross += gross;
        totalTax += tax;
        totalNet += net;
        return {
          workerId: w.workerId,
          worker: w.worker,
          rate: w.rate,
          hours: Math.round(w.hours * 100) / 100,
          overtime: Math.round(overtimeHours * 100) / 100,
          gross: Math.round(gross * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          net: Math.round(net * 100) / 100,
        };
      });

      return {
        period: key,
        label: group.label,
        hours: Math.round(totalHours * 100) / 100,
        gross: Math.round(totalGross * 100) / 100,
        tax: Math.round(totalTax * 100) / 100,
        net: Math.round(totalNet * 100) / 100,
        workers: workerBreakdown,
      };
    }).sort((a, b) => b.period.localeCompare(a.period)); // newest first

    res.json(result);
  } catch (error) {
    console.error('Payroll summary error:', error);
    res.status(500).json({ error: 'Server error computing payroll summary' });
  }
});

// Get payroll statistics for dashboard
router.get('/stats/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [totalCost] = await pool.query('SELECT SUM(gross) as total FROM payroll');
    const [pending] = await pool.query('SELECT SUM(net_pay) as total, COUNT(*) as count FROM payroll WHERE status = "Pending"');
    const [expenses] = await pool.query('SELECT SUM(tax_ni + advance_deduction) as total FROM payroll');
    
    res.json({
      totalCost: totalCost[0].total || 0,
      pending: pending[0].total || 0,
      pendingCount: pending[0].count || 0,
      expenses: expenses[0].total || 0
    });
  } catch (error) {
    console.error('Get payroll stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
