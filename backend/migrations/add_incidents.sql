-- Phase 2: Incident reporting
-- Workers report incidents (optionally with photo/document attachments);
-- admins triage them with status, severity and internal-only notes.
-- Also applied idempotently by backend/app.js ensureSchema() on boot.
CREATE TABLE IF NOT EXISTS incidents (
  id VARCHAR(50) NOT NULL PRIMARY KEY,
  reported_by VARCHAR(64) NOT NULL,
  reporter_name VARCHAR(255) NOT NULL,
  location_id VARCHAR(50) NULL,
  location_name VARCHAR(255) NULL,
  attendance_id VARCHAR(50) NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
  status ENUM('Open', 'Under Review', 'Resolved', 'Closed') NOT NULL DEFAULT 'Open',
  internal_notes JSON NULL,
  attachments JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_incidents_status (status),
  INDEX idx_incidents_severity (severity),
  INDEX idx_incidents_location (location_id),
  INDEX idx_incidents_created (created_at)
);
