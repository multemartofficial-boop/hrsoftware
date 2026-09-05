-- Phase E Part 1: per-worker BS7858 compliance checklist
-- One row per (worker_id, check_key). status: not_started | in_progress | complete
-- level is used by the criminal-records check (Basic/Standard/Enhanced)
CREATE TABLE IF NOT EXISTS worker_compliance_checks (
  worker_id VARCHAR(20) NOT NULL,
  check_key VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'not_started',
  completed_date DATE NULL,
  notes TEXT NULL,
  level VARCHAR(20) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (worker_id, check_key)
);
