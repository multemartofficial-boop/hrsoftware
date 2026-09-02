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
        billingMultiplier: newSettings[0].billing_multiplier
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
      billingMultiplier: settings[0].billing_multiplier
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
      billingMultiplier
    } = req.body;

    await pool.query(
      `UPDATE settings 
      SET hourly_rate = ?, overtime_multiplier = ?, overtime_threshold = ?, contract_months = ?,
          tax_rate = ?, ni_rate = ?, pension_rate = ?, max_advance = ?,
          first_reminder_days = ?, final_reminder_days = ?, company_name = ?,
          payroll_email = ?, billing_multiplier = ?
      WHERE id = 1`,
      [
        hourlyRate, overtimeMultiplier, overtimeThreshold, contractMonths,
        taxRate, niRate, pensionRate, maxAdvance,
        firstReminderDays, finalReminderDays, companyName,
        payrollEmail, billingMultiplier
      ]
    );

    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
