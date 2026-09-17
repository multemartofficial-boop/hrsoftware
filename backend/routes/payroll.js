const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logActionFromReq } = require('../utils/action-log');

// Generate payroll ID
const generatePayrollId = () => {
  return `PYRL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

// Helper: format a MySQL DATE/Date value as 'YYYY-MM-DD' using LOCAL date parts
// (toISOString() would shift the day when the server timezone is ahead of UTC)
const toLocalDateStr = (v) => {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
};

// Helper: fetch configured UK bank holiday dates as a Set of 'YYYY-MM-DD' strings
const getBankHolidaySet = async () => {
  const [rows] = await pool.query('SELECT holiday_date FROM bank_holidays');
  const set = new Set();
  for (const r of rows) {
    set.add(toLocalDateStr(r.holiday_date));
  }
  return set;
};

const round2 = (n) => Math.round(n * 100) / 100;

// Monthly-salary proration (Part 2): each calendar month the period touches
// contributes monthlySalary × (days of the period inside that month / days in
// that month). A period covering a whole calendar month therefore pays exactly
// one monthly salary. `joinedStr` bounds the start so a worker never accrues
// salary before their join date.
const prorateMonthlySalary = (monthlySalary, fromStr, toStr, joinedStr) => {
  const toLocal = (v) => v instanceof Date
    ? new Date(v.getFullYear(), v.getMonth(), v.getDate())
    : new Date(String(v).slice(0, 10) + 'T00:00:00');
  const from = toLocal(fromStr);
  const to = toLocal(toStr);
  const joined = joinedStr ? toLocal(joinedStr) : null;
  const start = joined && joined > from ? joined : from;
  const breakdown = [];
  if (!(monthlySalary > 0) || start > to) return { amount: 0, breakdown };
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= to) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthStart = cursor;
    const monthEnd = new Date(y, m, daysInMonth);
    const s = start > monthStart ? start : monthStart;
    const e = to < monthEnd ? to : monthEnd;
    if (s <= e) {
      const days = Math.round((e - s) / 86400000) + 1;
      breakdown.push({
        month: `${y}-${String(m + 1).padStart(2, '0')}`,
        days,
        daysInMonth,
        amount: round2((monthlySalary * days) / daysInMonth),
      });
    }
    cursor = new Date(y, m + 1, 1);
  }
  return { amount: round2(breakdown.reduce((t, b) => t + b.amount, 0)), breakdown };
};

// Helper: Calculate payroll
// Phase C: hours worked on configured bank holidays are paid at
// rate * holiday_pay_multiplier. Holiday hours still count toward the
// overtime threshold, but are always paid at the holiday rate rather
// than the overtime rate (overtime is drawn from non-holiday hours).
const calculatePayroll = async (workerId, from, to, advance, settings, { allowZeroHours = false } = {}) => {
  // Get worker details
  const [workers] = await pool.query('SELECT * FROM workers WHERE id = ?', [workerId]);
  if (workers.length === 0) {
    throw new Error('Worker not found');
  }

  const worker = workers[0];
  // Convert rate from string to number
  const rate = Number(worker.rate) || 0;
  const payType = worker.pay_type === 'salary' ? 'salary' : 'hourly';
  const monthlySalary = Number(worker.monthly_salary) || 0;

  const holidays = await getBankHolidaySet();

  // Get per-day hours so holiday dates can be separated from regular hours.
  // Statutory holiday accrual is summed from the value STORED on each entry at
  // check-out time (not recalculated), so past entries keep their original figure.
  const [attendance] = await pool.query(
    'SELECT date, SUM(hours_worked) as day_hours, SUM(holiday_accrued_hours) as day_accrued FROM attendance WHERE worker_id = ? AND date >= ? AND date <= ? GROUP BY date',
    [workerId, from, to]
  );

  let totalHours = 0;
  let holidayHours = 0;
  let holidayAccruedHours = 0;
  for (const row of attendance) {
    const dateStr = toLocalDateStr(row.date);
    const h = Number(row.day_hours) || 0;
    totalHours += h;
    holidayAccruedHours += Number(row.day_accrued) || 0;
    if (holidays.has(dateStr)) holidayHours += h;
  }
  const regularHours = totalHours - holidayHours;

  // Validate: if no attendance records, return early with a clear error.
  // Salaried workers are paid per calendar day, not per attended hour, so a
  // period with no attendance is still payable for them.
  if (totalHours === 0 && !allowZeroHours && payType !== 'salary') {
    throw new Error('No attendance records found for this worker in the selected date range');
  }

  // Convert settings from strings to numbers
  const overtimeThreshold = Number(settings.overtime_threshold) || 40;
  const overtimeMultiplier = Number(settings.overtime_multiplier) || 1.5;
  const holidayMultiplier = Number(settings.holiday_pay_multiplier) || 2;
  const holidayAccrualRate = Number(settings.holiday_accrual_rate);
  const accrualRate = Number.isFinite(holidayAccrualRate) ? holidayAccrualRate : 12.07;
  const taxRateValue = Number(settings.tax_rate) || 0;
  const niRateValue = Number(settings.ni_rate) || 0;
  const taxRatePercent = (taxRateValue + niRateValue) / 100;

  // Monthly-salaried workers (Part 2): gross is the monthly salary prorated by
  // calendar days across the period — hours are recorded for reference only
  // and never multiplied by a rate. No overtime/bank-holiday/holiday-accrual
  // pay applies on top of a salary. Tax/NI and advance deductions still apply.
  if (payType === 'salary') {
    if (!(monthlySalary > 0)) {
      throw new Error('This worker is on Monthly Salary but has no monthly salary amount set — set one on their worker record first');
    }
    const { amount: salaryGross, breakdown } = prorateMonthlySalary(monthlySalary, from, to, worker.joined);
    const gross = salaryGross;
    const tax = gross * taxRatePercent;
    const net = gross - tax - advance;
    if (!Number.isFinite(gross) || !Number.isFinite(tax) || !Number.isFinite(net)) {
      throw new Error('Invalid calculation results: gross, tax, or net pay is not a valid number');
    }
    return {
      workerId,
      worker: worker.name,
      payType,
      monthlySalary,
      salaryBreakdown: breakdown,
      rate: 0,
      hours: totalHours,
      regularHours: Math.round(totalHours * 100) / 100,
      overtime: 0,
      holidayHours: Math.round(holidayHours * 100) / 100,
      holidayPay: 0,
      holidayMultiplier,
      holidayAccruedHours: Math.round(holidayAccruedHours * 100) / 100,
      holidayAccrualPay: 0,
      holidayAccrualRate: accrualRate,
      gross: Math.round(gross * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      advance: Math.round(advance * 100) / 100,
      net: Math.round(net * 100) / 100,
      from,
      to
    };
  }

  // Overtime: total hours count toward the threshold, but the excess is
  // drawn from non-holiday hours first — holiday hours are always paid
  // at the holiday rate instead of the overtime rate.
  const weeks = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / (7 * 24 * 60 * 60 * 1000)));
  const overtimeHours = Math.min(regularHours, Math.max(0, totalHours - overtimeThreshold * weeks));
  const normalHours = regularHours - overtimeHours;

  // Calculate amounts
  const regularGross = (normalHours * rate) + (overtimeHours * rate * overtimeMultiplier);
  const holidayPay = holidayHours * rate * holidayMultiplier;
  // Statutory holiday accrual value: accrued hours × base hourly rate.
  // Independent of bank-holiday pay — both apply on the same day when relevant.
  const holidayAccrualPay = holidayAccruedHours * rate;
  const gross = regularGross + holidayPay + holidayAccrualPay;
  const tax = gross * taxRatePercent;
  const net = gross - tax - advance;

  // Validate all values are finite numbers
  if (!Number.isFinite(gross) || !Number.isFinite(tax) || !Number.isFinite(net)) {
    throw new Error('Invalid calculation results: gross, tax, or net pay is not a valid number');
  }

  return {
    workerId,
    worker: worker.name,
    payType,
    monthlySalary: null,
    rate,
    hours: totalHours,
    regularHours: Math.round(normalHours * 100) / 100,
    overtime: Math.round(overtimeHours * 100) / 100,
    holidayHours: Math.round(holidayHours * 100) / 100,
    holidayPay: Math.round(holidayPay * 100) / 100,
    holidayMultiplier,
    holidayAccruedHours: Math.round(holidayAccruedHours * 100) / 100,
    holidayAccrualPay: Math.round(holidayAccrualPay * 100) / 100,
    holidayAccrualRate: accrualRate,
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
      payType: p.pay_type === 'salary' ? 'salary' : 'hourly',
      monthlySalary: p.monthly_salary != null ? Number(p.monthly_salary) : null,
      payDetails: p.pay_details
        ? (typeof p.pay_details === 'string' ? JSON.parse(p.pay_details) : p.pay_details)
        : null,
      hours: Number(p.hours),
      overtime: Number(p.overtime),
      holidayHours: Number(p.holiday_hours || 0),
      holidayPay: Number(p.holiday_pay || 0),
      holidayAccruedHours: Number(p.holiday_accrued_hours || 0),
      holidayAccrualPay: Number(p.holiday_accrual_pay || 0),
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
      (id, worker_id, worker, period_start, period_end, pay_type, monthly_salary, pay_details,
       hours, overtime, holiday_hours, holiday_pay,
       holiday_accrued_hours, holiday_accrual_pay, rate, gross, advance_deduction, tax_ni, net_pay, status, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())`,
      [payrollId, calculation.workerId, calculation.worker, calculation.from, calculation.to,
       calculation.payType || 'hourly', calculation.monthlySalary ?? null,
       calculation.payType === 'salary' ? JSON.stringify({ salaryBreakdown: calculation.salaryBreakdown || [] }) : null,
       calculation.hours, calculation.overtime, calculation.holidayHours, calculation.holidayPay,
       calculation.holidayAccruedHours, calculation.holidayAccrualPay,
       calculation.rate, calculation.gross,
       calculation.advance, calculation.tax, calculation.net]
    );

    // Log notification
    await pool.query(
      'INSERT INTO notifications (id, worker, worker_id, message, urgency, occurred_at) VALUES (?, ?, ?, ?, "info", "Just now")',
      [`N-${Date.now()}`, calculation.worker, calculation.workerId, `Payroll ${payrollId} generated`]
    );

    await logActionFromReq(req, 'generated_payroll', 'payroll', payrollId, {
      workerId: calculation.workerId,
      worker: calculation.worker,
      period: `${calculation.from} → ${calculation.to}`,
      payType: calculation.payType,
      gross: calculation.gross,
      net: calculation.net,
    });
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

    await logActionFromReq(req, 'updated_payroll_status', 'payroll', req.params.id, { status });
    res.json({ message: 'Payroll status updated successfully' });
  } catch (error) {
    console.error('Update payroll status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete payroll
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT worker_id, worker, period_start, period_end FROM payroll WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM payroll WHERE id = ?', [req.params.id]);
    await logActionFromReq(req, 'deleted_payroll', 'payroll', req.params.id, {
      workerId: rows[0]?.worker_id,
      worker: rows[0]?.worker,
      period: rows[0] ? `${toLocalDateStr(rows[0].period_start)} → ${toLocalDateStr(rows[0].period_end)}` : undefined,
    });
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
    const holidayMultiplier = Number(s.holiday_pay_multiplier) || 2;
    const accrualRateRaw = Number(s.holiday_accrual_rate);
    const holidayAccrualRate = Number.isFinite(accrualRateRaw) ? accrualRateRaw : 12.07;
    const taxRateValue = Number(s.tax_rate) || 0;
    const niRateValue = Number(s.ni_rate) || 0;
    const taxRatePercent = (taxRateValue + niRateValue) / 100;
    const holidaySet = await getBankHolidaySet();

    // Fetch all attendance joined with worker rates (incl. stored holiday accrual)
    const [rows] = await pool.query(
      `SELECT a.worker_id, w.name AS worker_name, w.rate, w.pay_type, w.monthly_salary, w.joined,
              a.date, a.hours_worked, a.holiday_accrued_hours
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

    // Calendar bounds of a period key — used to prorate monthly salaries.
    const periodBounds = (key) => {
      if (period === 'yearly') return { start: `${key}-01-01`, end: `${key}-12-31` };
      if (period === 'monthly') {
        const [y, m] = key.split('-').map(Number);
        const dim = new Date(y, m, 0).getDate();
        return { start: `${key}-01`, end: `${key}-${String(dim).padStart(2, '0')}` };
      }
      const [start, end] = key.split('_');
      return { start, end };
    };

    // All period keys covering [fromStr, toStr] — used so salaried workers
    // appear in periods even when they logged no attendance (a salary accrues
    // every calendar day, not just days with check-ins).
    const periodKeysCovering = (fromStr, toStr) => {
      const keys = [];
      const from = new Date(String(fromStr).slice(0, 10) + 'T00:00:00');
      const to = new Date(String(toStr).slice(0, 10) + 'T00:00:00');
      if (from > to) return keys;
      if (period === 'yearly') {
        for (let y = from.getFullYear(); y <= to.getFullYear(); y++) keys.push(String(y));
      } else if (period === 'monthly') {
        const cur = new Date(from.getFullYear(), from.getMonth(), 1);
        while (cur <= to) {
          keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
          cur.setMonth(cur.getMonth() + 1);
        }
      } else {
        const cur = new Date(from);
        cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)); // Monday of that week
        while (cur <= to) {
          keys.push(periodKey(toLocalDateStr(cur)));
          cur.setDate(cur.getDate() + 7);
        }
      }
      return keys;
    };

    const ensureWorkerEntry = (pk, id, name, payType, monthlySalary, joined) => {
      if (!groups[pk]) groups[pk] = { label: periodLabel(pk), workers: {} };
      if (!groups[pk].workers[id]) {
        groups[pk].workers[id] = {
          workerId: id,
          worker: name,
          rate: 0,
          payType,
          monthlySalary,
          joined,
          hours: 0,
          holidayHours: 0,
          holidayAccruedHours: 0,
        };
      }
      return groups[pk].workers[id];
    };

    // Group attendance by period, then by worker
    const groups = {};
    for (const row of rows) {
      const dateStr = toLocalDateStr(row.date);
      const pk = periodKey(dateStr);
      const w = ensureWorkerEntry(
        pk,
        row.worker_id,
        row.worker_name,
        row.pay_type === 'salary' ? 'salary' : 'hourly',
        row.monthly_salary != null ? Number(row.monthly_salary) : null,
        toLocalDateStr(row.joined)
      );
      w.rate = Number(row.rate) || 0;
      const h = Number(row.hours_worked) || 0;
      w.hours += h;
      w.holidayAccruedHours += Number(row.holiday_accrued_hours) || 0;
      if (holidaySet.has(dateStr)) {
        w.holidayHours += h;
      }
    }

    // Salaried workers accrue pay on calendar days, not attended days — add
    // them to every period overlapping their employment so the summary
    // reflects real payroll cost even for weeks/months with no attendance.
    const [salariedWorkers] = await pool.query(
      "SELECT id, name, monthly_salary, joined FROM workers WHERE pay_type = 'salary'"
    );
    const todayStr = toLocalDateStr(new Date());
    for (const sw of salariedWorkers) {
      const joinedStr = sw.joined ? toLocalDateStr(sw.joined) : todayStr;
      if (joinedStr > todayStr) continue;
      for (const pk of periodKeysCovering(joinedStr, todayStr)) {
        ensureWorkerEntry(pk, sw.id, sw.name, 'salary', Number(sw.monthly_salary) || null, joinedStr);
      }
    }

    // Calculate payroll figures per worker per period, then aggregate
    const result = Object.entries(groups).map(([key, group]) => {
      // Weeks used for overtime threshold calculation (same formula as calculatePayroll:
      // ceil(days_in_period / 7))
      let weeks;
      if (period === 'weekly') {
        weeks = 1;
      } else if (period === 'monthly') {
        const [y, m] = key.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        weeks = Math.max(1, Math.ceil((daysInMonth - 1) / 7));
      } else {
        weeks = Math.max(1, Math.ceil(365 / 7));
      }

      let totalHours = 0, totalGross = 0, totalTax = 0, totalNet = 0, totalHolidayHours = 0, totalHolidayPay = 0;
      let totalAccruedHours = 0, totalAccrualPay = 0;
      const workerBreakdown = Object.values(group.workers).map((w) => {
        let overtimeHours = 0, holidayPay = 0, holidayAccrualPay = 0, gross;
        if (w.payType === 'salary') {
          // Monthly salary prorated by the calendar days of this period —
          // hours are tracked for records but never multiplied by a rate.
          const bounds = periodBounds(key);
          gross = prorateMonthlySalary(w.monthlySalary || 0, bounds.start, bounds.end, w.joined).amount;
        } else {
          // Same holiday/overtime rule as calculatePayroll: holiday hours count
          // toward the threshold but are paid at the holiday rate.
          const regularHours = w.hours - w.holidayHours;
          overtimeHours = Math.min(regularHours, Math.max(0, w.hours - overtimeThreshold * weeks));
          const normalHours = regularHours - overtimeHours;
          holidayPay = w.holidayHours * w.rate * holidayMultiplier;
          holidayAccrualPay = w.holidayAccruedHours * w.rate;
          gross = (normalHours * w.rate) + (overtimeHours * w.rate * overtimeMultiplier) + holidayPay + holidayAccrualPay;
        }
        const tax = gross * taxRatePercent;
        const net = gross - tax;
        totalHours += w.hours;
        totalGross += gross;
        totalTax += tax;
        totalNet += net;
        totalHolidayHours += w.holidayHours;
        totalHolidayPay += holidayPay;
        totalAccruedHours += w.holidayAccruedHours;
        totalAccrualPay += holidayAccrualPay;
        return {
          workerId: w.workerId,
          worker: w.worker,
          payType: w.payType,
          monthlySalary: w.monthlySalary,
          rate: w.rate,
          hours: Math.round(w.hours * 100) / 100,
          overtime: Math.round(overtimeHours * 100) / 100,
          holidayHours: Math.round(w.holidayHours * 100) / 100,
          holidayPay: Math.round(holidayPay * 100) / 100,
          holidayAccruedHours: Math.round(w.holidayAccruedHours * 100) / 100,
          holidayAccrualPay: Math.round(holidayAccrualPay * 100) / 100,
          gross: Math.round(gross * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          net: Math.round(net * 100) / 100,
        };
      });

      return {
        period: key,
        label: group.label,
        hours: Math.round(totalHours * 100) / 100,
        holidayHours: Math.round(totalHolidayHours * 100) / 100,
        holidayPay: Math.round(totalHolidayPay * 100) / 100,
        holidayAccruedHours: Math.round(totalAccruedHours * 100) / 100,
        holidayAccrualPay: Math.round(totalAccrualPay * 100) / 100,
        holidayAccrualRate,
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
