-- Statutory holiday accrual (UK: 5.6 weeks / 46.4 weeks = 12.07%)
-- Distinct from Phase C bank-holiday pay (extra pay for working ON a bank holiday).
-- These are also applied idempotently by backend/app.js ensureSchema() on boot.

-- 1) Configurable accrual rate (percent of hours worked)
ALTER TABLE settings ADD COLUMN holiday_accrual_rate DECIMAL(5,2) NOT NULL DEFAULT 12.07;

-- 2) Per-entry accrued holiday hours, stored at check-out time so historical
--    records keep their originally-calculated value if the rate changes later.
ALTER TABLE attendance ADD COLUMN holiday_accrued_hours DECIMAL(8,4) NOT NULL DEFAULT 0;

-- 3) Holiday accrual line on generated payroll records
ALTER TABLE payroll ADD COLUMN holiday_accrued_hours DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll ADD COLUMN holiday_accrual_pay DECIMAL(10,2) NOT NULL DEFAULT 0;
