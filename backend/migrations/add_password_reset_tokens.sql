-- Create password reset/setup tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    worker_id VARCHAR(50) NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    token_type ENUM('setup', 'reset') NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_token (token),
    INDEX idx_worker_id (worker_id),
    INDEX idx_expires_at (expires_at)
);