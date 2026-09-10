const pool = require('../config/database');

// UK statutory holiday entitlement: 5.6 weeks / 46.4 working weeks = 12.07%
const DEFAULT_HOLIDAY_ACCRUAL_RATE = 12.07;

// Read the configured accrual rate (percent) from settings, falling back to the statutory default
const getHolidayAccrualRate = async () => {
  try {
    const [rows] = await pool.query('SELECT holiday_accrual_rate FROM settings WHERE id = 1');
    const rate = Number(rows[0]?.holiday_accrual_rate);
    return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_HOLIDAY_ACCRUAL_RATE;
  } catch {
    return DEFAULT_HOLIDAY_ACCRUAL_RATE;
  }
};

// Accrued holiday hours for a shift: hours_worked × rate%. Stored to 4dp on the
// attendance row so historical entries are never silently recalculated.
const accrueHolidayHours = (hoursWorked, ratePercent) => {
  const h = Number(hoursWorked) || 0;
  const r = Number(ratePercent) || 0;
  return Math.round(h * (r / 100) * 10000) / 10000;
};

module.exports = { DEFAULT_HOLIDAY_ACCRUAL_RATE, getHolidayAccrualRate, accrueHolidayHours };
