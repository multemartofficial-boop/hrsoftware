const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Admin: Get settings
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');

    // Auto-create default settings if none exist
    if (settings.length === 0) {
      await pool.query(
        `INSERT INTO settings (id, hourly_rate, overtime_multiplier, overtime_threshold, contract_months,
         tax_rate, ni_rate, pension_rate, max_advance, first_reminder_days, final_reminder_days,
         company_name, payroll_email, billing_multiplier)
         VALUES (1, 14.50, 1.5, 40, 3, 20, 12, 5, 500, 30, 7, 'WorkHR Staffing Ltd', 'payroll@workhr.co.uk', 1.45)`
      );
      const [newSettings] = await pool.query('SELECT * FROM settings WHERE id = 1');

      // Transform snake_case to camelCase for frontend compatibility
      const transformed = {
        hourlyRate: newSettings[0].hourly_rate,
        overtimeMultiplier: newSettings[0].overtime_multiplier,
        overtimeThreshold: newSettings[0].overtime_threshold,
        contractMonths: newSettings[0].contract_months,
        taxRate: newSettings[0].tax_rate,
        niRate: newSettings[0].ni_rate,
        pensionRate: newSettings[0].pension_rate,
        maxAdvance: newSettings[0].max_advance,
        firstReminderDays: newSettings[0].first_reminder_days,
        finalReminderDays: newSettings[0].final_reminder_days,
        companyName: newSettings[0].company_name,
        payrollEmail: newSettings[0].payroll_email,
        billingMultiplier: newSettings[0].billing_multiplier,
        holidayPayMultiplier: newSettings[0].holiday_pay_multiplier,
        holidayAccrualRate: newSettings[0].holiday_accrual_rate ?? 12.07
      };

      return res.json(transformed);
    }

    // Transform snake_case to camelCase for frontend compatibility
    const transformed = {
      hourlyRate: settings[0].hourly_rate,
      overtimeMultiplier: settings[0].overtime_multiplier,
      overtimeThreshold: settings[0].overtime_threshold,
      contractMonths: settings[0].contract_months,
      taxRate: settings[0].tax_rate,
      niRate: settings[0].ni_rate,
      pensionRate: settings[0].pension_rate,
      maxAdvance: settings[0].max_advance,
      firstReminderDays: settings[0].first_reminder_days,
      finalReminderDays: settings[0].final_reminder_days,
      companyName: settings[0].company_name,
      payrollEmail: settings[0].payroll_email,
      billingMultiplier: settings[0].billing_multiplier,
      holidayPayMultiplier: settings[0].holiday_pay_multiplier,
      holidayAccrualRate: settings[0].holiday_accrual_rate ?? 12.07
    };

    res.json(transformed);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: true, message: 'Failed to load settings' });
  }
});

// Admin: Update settings
router.put('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      hourlyRate,
      overtimeMultiplier,
      overtimeThreshold,
      contractMonths,
      taxRate,
      niRate,
      pensionRate,
      maxAdvance,
      firstReminderDays,
      finalReminderDays,
      companyName,
      payrollEmail,
      billingMultiplier,
      holidayPayMultiplier,
      holidayAccrualRate
    } = req.body;

    const accrualRate = holidayAccrualRate !== undefined && holidayAccrualRate !== null && holidayAccrualRate !== ''
      ? Number(holidayAccrualRate)
      : null;
    if (accrualRate !== null && (!Number.isFinite(accrualRate) || accrualRate < 0 || accrualRate > 100)) {
      return res.status(400).json({ error: 'Holiday accrual rate must be between 0 and 100 (%)' });
    }

    await pool.query(
      `UPDATE settings
      SET hourly_rate = ?, overtime_multiplier = ?, overtime_threshold = ?, contract_months = ?,
          tax_rate = ?, ni_rate = ?, pension_rate = ?, max_advance = ?,
          first_reminder_days = ?, final_reminder_days = ?, company_name = ?,
          payroll_email = ?, billing_multiplier = ?, holiday_pay_multiplier = ?,
          holiday_accrual_rate = COALESCE(?, holiday_accrual_rate)
      WHERE id = 1`,
      [
        hourlyRate, overtimeMultiplier, overtimeThreshold, contractMonths,
        taxRate, niRate, pensionRate, maxAdvance,
        firstReminderDays, finalReminderDays, companyName,
        payrollEmail, billingMultiplier, holidayPayMultiplier,
        accrualRate
      ]
    );

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ---------------- UK bank holidays (Phase C) ---------------- */

// Admin: List bank holidays
router.get('/bank-holidays', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, holiday_date, name FROM bank_holidays ORDER BY holiday_date'
    );
    const fmtD = (v) => v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
    res.json(rows.map(r => ({ id: r.id, date: fmtD(r.holiday_date), name: r.name })));
  } catch (error) {
    console.error('Get bank holidays error:', error);
    res.status(500).json({ error: 'Failed to load bank holidays' });
  }
});

// Admin: Add a bank holiday
router.post('/bank-holidays', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { date, name } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
    }
    await pool.query(
      'INSERT INTO bank_holidays (holiday_date, name) VALUES (?, ?)',
      [date, (name && String(name).trim()) || 'Bank Holiday']
    );
    const [rows] = await pool.query(
      'SELECT id, holiday_date, name FROM bank_holidays ORDER BY holiday_date'
    );
    const fmtD = (v) => v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
    res.status(201).json(rows.map(r => ({ id: r.id, date: fmtD(r.holiday_date), name: r.name })));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'That date is already a bank holiday' });
    }
    console.error('Add bank holiday error:', error);
    res.status(500).json({ error: 'Failed to add bank holiday' });
  }
});

// Admin: Update a bank holiday (rename or move the date)
router.put('/bank-holidays/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { date, name } = req.body;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' });
    }
    await pool.query(
      'UPDATE bank_holidays SET holiday_date = COALESCE(?, holiday_date), name = COALESCE(?, name) WHERE id = ?',
      [date || null, name ? String(name).trim() : null, req.params.id]
    );
    res.json({ message: 'Bank holiday updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'That date is already a bank holiday' });
    }
    console.error('Update bank holiday error:', error);
    res.status(500).json({ error: 'Failed to update bank holiday' });
  }
});

// Admin: Delete a bank holiday
router.delete('/bank-holidays/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM bank_holidays WHERE id = ?', [req.params.id]);
    res.json({ message: 'Bank holiday removed' });
  } catch (error) {
    console.error('Delete bank holiday error:', error);
    res.status(500).json({ error: 'Failed to remove bank holiday' });
  }
});

module.exports = router;
