-- Phase 4: Client portal
-- New 'client' user role; client accounts link a users row to a clients record,
-- which maps to one or more locations (schedule/coverage view) and to a
-- buyer_name used by buyer_income (billing view).
-- Also applied idempotently by backend/app.js ensureSchema() on boot.

ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'worker', 'client') NOT NULL;

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(50) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  buyer_name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clients_user (user_id),
  INDEX idx_clients_buyer (buyer_name)
);

CREATE TABLE IF NOT EXISTS client_locations (
  client_id VARCHAR(50) NOT NULL,
  location_id VARCHAR(50) NOT NULL,
  UNIQUE KEY uq_client_location (client_id, location_id)
);
