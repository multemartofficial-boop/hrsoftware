-- Phase 1: Action History audit log
-- Records meaningful state-changing actions (approvals, payroll generation,
-- settings changes, etc.) with the actor who performed them.
-- Also applied idempotently by backend/app.js ensureSchema() on boot.
CREATE TABLE IF NOT EXISTS action_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_type ENUM('admin', 'worker', 'system') NOT NULL DEFAULT 'system',
  actor_id VARCHAR(64) NULL,
  actor_name VARCHAR(255) NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NULL,
  target_id VARCHAR(64) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action_logs_created (created_at),
  INDEX idx_action_logs_action (action),
  INDEX idx_action_logs_actor (actor_type, actor_id)
);
