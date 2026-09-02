-- Add temporary fields to store approved worker info before password setup
ALTER TABLE registration_applications 
ADD COLUMN IF NOT EXISTS worker_id VARCHAR(50) NULL AFTER status,
ADD COLUMN IF NOT EXISTS worker_joined DATE NULL AFTER worker_id,
ADD COLUMN IF NOT EXISTS worker_expiry DATE NULL AFTER worker_joined,
ADD COLUMN IF NOT EXISTS approval_token VARCHAR(255) NULL AFTER worker_expiry,
ADD INDEX IF NOT EXISTS idx_worker_id (worker_id),
ADD INDEX IF NOT EXISTS idx_approval_token (approval_token);