-- Phase F: daily worker-location assignments
-- UNIQUE(worker_id, assigned_date) enforces one assignment per worker per day
CREATE TABLE IF NOT EXISTS worker_location_assignments (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  worker_id VARCHAR(20) NOT NULL,
  location_id VARCHAR(40) NOT NULL,
  assigned_date DATE NOT NULL,
  created_by_admin_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_worker_date (worker_id, assigned_date)
);

-- none | match | mismatch
ALTER TABLE attendance
  ADD COLUMN assignment_status VARCHAR(20) NOT NULL DEFAULT 'none';
