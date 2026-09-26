-- Database-backed file storage.
-- Uploaded files (signature documents, application uploads, incident
-- attachments) are stored here so they persist on serverless deployments
-- where the local filesystem is ephemeral.
CREATE TABLE IF NOT EXISTS stored_files (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NULL,
  size INT UNSIGNED NULL,
  data LONGBLOB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- documents + signature_requests reference a stored file by id
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_id VARCHAR(64) NULL;
ALTER TABLE signature_requests ADD COLUMN IF NOT EXISTS file_id VARCHAR(64) NULL;
