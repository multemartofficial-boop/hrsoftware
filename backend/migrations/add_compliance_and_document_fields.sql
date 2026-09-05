-- Phase A: registration form additions (how heard, passport, visa, SIA badge)
-- plus an admin-only compliance checklist stored as JSON (same style as `details`).
ALTER TABLE registration_applications
ADD COLUMN IF NOT EXISTS how_heard VARCHAR(50) NULL AFTER applied_for,
ADD COLUMN IF NOT EXISTS passport_country VARCHAR(100) NULL AFTER how_heard,
ADD COLUMN IF NOT EXISTS passport_number VARCHAR(50) NULL AFTER passport_country,
ADD COLUMN IF NOT EXISTS passport_expiry DATE NULL AFTER passport_number,
ADD COLUMN IF NOT EXISTS visa_number VARCHAR(50) NULL AFTER passport_expiry,
ADD COLUMN IF NOT EXISTS visa_expiry DATE NULL AFTER visa_number,
ADD COLUMN IF NOT EXISTS sia_badge_number VARCHAR(50) NULL AFTER visa_expiry,
ADD COLUMN IF NOT EXISTS sia_badge_expiry DATE NULL AFTER sia_badge_number,
ADD COLUMN IF NOT EXISTS compliance LONGTEXT NULL AFTER details;

-- Carried over to the worker record on approval / password setup.
-- Needed by later phases (visa & SIA expiry warnings).
ALTER TABLE workers
ADD COLUMN IF NOT EXISTS passport_country VARCHAR(100) NULL AFTER nid,
ADD COLUMN IF NOT EXISTS passport_number VARCHAR(50) NULL AFTER passport_country,
ADD COLUMN IF NOT EXISTS passport_expiry DATE NULL AFTER passport_number,
ADD COLUMN IF NOT EXISTS visa_number VARCHAR(50) NULL AFTER passport_expiry,
ADD COLUMN IF NOT EXISTS visa_expiry DATE NULL AFTER visa_number,
ADD COLUMN IF NOT EXISTS sia_badge_number VARCHAR(50) NULL AFTER visa_expiry,
ADD COLUMN IF NOT EXISTS sia_badge_expiry DATE NULL AFTER sia_badge_number;
