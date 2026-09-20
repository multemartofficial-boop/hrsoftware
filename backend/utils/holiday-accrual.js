const pool = require('../config/database');

// UK statutory holiday entitlement: 5.6 weeks / 46.4 working weeks = 12.07%
const DEFAULT_HOLIDAY_ACCRUAL_RATE = 12.07;

// Statutory minimum for a full-time worker: 5.6 weeks × 5 days = 28 days
const STATUTORY_ANNUAL_DAYS = 28;

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

// Round a fractional day UP to the nearest half day — statutory holiday may
// never be rounded down (GOV.UK / Acas first-year accrual rule).
const roundUpHalfDay = (days) => Math.ceil((Number(days) || 0) * 2) / 2;

// Contract types
const EMPLOYMENT_FULL_TIME = 'full_time';
const EMPLOYMENT_IRREGULAR = 'irregular';

const normalizeEmploymentType = (v) =>
  v === EMPLOYMENT_FULL_TIME ? EMPLOYMENT_FULL_TIME : EMPLOYMENT_IRREGULAR;

// Full-time statutory entitlement for the current leave year (the leave year
// runs Jan–Dec). New starters get the pro-rata share: months remaining in the
// leave year ÷ 12 × 28, rounded UP to the nearest half day. Workers who joined
// before this leave year get the full 28 days.
const fullTimeHoliday = (joined, now = new Date()) => {
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const joinedDate = joined ? new Date(joined) : null;
  const startedThisYear = joinedDate && joinedDate > yearStart;

  // Months remaining = join month through December, inclusive of the join month.
  const monthsRemaining = startedThisYear ? 12 - joinedDate.getMonth() : 12;
  const entitlementDays = startedThisYear
    ? roundUpHalfDay((monthsRemaining / 12) * STATUTORY_ANNUAL_DAYS)
    : STATUTORY_ANNUAL_DAYS;

  // First-year accrual: entitlement builds at 1/12 of the annual total per
  // month started in this leave year, rounded up to the nearest half day.
  const monthsWorked = Math.max(
    1,
    Math.min(
      monthsRemaining,
      (now.getFullYear() - (joinedDate?.getFullYear() ?? now.getFullYear())) * 12
        + now.getMonth() - (joinedDate?.getMonth() ?? now.getMonth()) + 1,
    ),
  );
  const accruedDays = startedThisYear
    ? roundUpHalfDay((monthsWorked / 12) * STATUTORY_ANNUAL_DAYS)
    : entitlementDays;

  return {
    leaveYearStart: `${year}-01-01`,
    leaveYearEnd: `${year}-12-31`,
    annualDays: STATUTORY_ANNUAL_DAYS,
    entitlementDays,
    accruedDays: Math.min(accruedDays, entitlementDays),
    monthsRemaining,
    startedThisYear: Boolean(startedThisYear),
  };
};

// Shift-level accrual that respects the worker's contract type: irregular /
// zero-hours workers accrue 12.07% of hours; full-time permanent staff get
// statutory days instead, so their shifts accrue 0 rolled-up hours.
const accrueForWorker = async (workerId, hoursWorked) => {
  const [rows] = await pool.query('SELECT employment_type FROM workers WHERE id = ?', [workerId]);
  if (normalizeEmploymentType(rows[0]?.employment_type) === EMPLOYMENT_FULL_TIME) return 0;
  return accrueHolidayHours(hoursWorked, await getHolidayAccrualRate());
};

// Holiday position for a worker row (workers table shape) — full-time gets
// statutory days; irregular/zero-hours gets 12.07% of hours worked this year.
const workerHoliday = async (worker) => {
  const type = normalizeEmploymentType(worker.employment_type);
  if (type === EMPLOYMENT_FULL_TIME) {
    return { type: 'statutory_days', ...fullTimeHoliday(worker.joined) };
  }
  const rate = await getHolidayAccrualRate();
  const year = new Date().getFullYear();
  const [rows] = await pool.query(
    'SELECT COALESCE(SUM(holiday_accrued_hours),0) AS accrued FROM attendance WHERE worker_id = ? AND YEAR(date) = ?',
    [worker.id, year]
  );
  return {
    type: 'accrual_hours',
    ratePercent: rate,
    accruedHours: Math.round(Number(rows[0]?.accrued || 0) * 100) / 100,
  };
};

module.exports = {
  DEFAULT_HOLIDAY_ACCRUAL_RATE,
  STATUTORY_ANNUAL_DAYS,
  EMPLOYMENT_FULL_TIME,
  EMPLOYMENT_IRREGULAR,
  normalizeEmploymentType,
  roundUpHalfDay,
  getHolidayAccrualRate,
  accrueHolidayHours,
  accrueForWorker,
  fullTimeHoliday,
  workerHoliday,
};
