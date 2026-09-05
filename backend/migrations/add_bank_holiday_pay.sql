-- Phase C: UK bank holiday pay
-- 1) Holiday pay multiplier in settings (e.g. 2.0 = double time)
ALTER TABLE settings ADD COLUMN holiday_pay_multiplier DECIMAL(4,2) NOT NULL DEFAULT 2.0;

-- 2) Editable list of UK bank holiday dates
CREATE TABLE IF NOT EXISTS bank_holidays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL DEFAULT 'Bank Holiday',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed with 2026 England & Wales bank holidays (admin can edit/remove)
INSERT IGNORE INTO bank_holidays (holiday_date, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-04', 'Early May Bank Holiday'),
  ('2026-05-25', 'Spring Bank Holiday'),
  ('2026-08-31', 'Summer Bank Holiday'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-28', 'Boxing Day (substitute)');

-- 3) Store holiday breakdown on generated payroll records
ALTER TABLE payroll ADD COLUMN holiday_hours DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll ADD COLUMN holiday_pay DECIMAL(10,2) NOT NULL DEFAULT 0;
