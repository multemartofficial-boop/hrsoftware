-- Phase G Part 2: signing + audit trail columns
ALTER TABLE signature_requests
  ADD COLUMN signature_type VARCHAR(20) NULL,
  ADD COLUMN viewed_at TIMESTAMP NULL,
  ADD COLUMN signed_content MEDIUMTEXT NULL,
  ADD COLUMN audit_log JSON NULL;
