-- Phase G: e-signature module
-- documents: uploaded PDFs (type='uploaded_pdf') or reusable text templates (type='template')
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'uploaded_pdf',
  file_path VARCHAR(500) NULL,
  content MEDIUMTEXT NULL,
  uploaded_by_admin_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- signature_requests: a document/template sent to a worker for signing
CREATE TABLE IF NOT EXISTS signature_requests (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  document_id VARCHAR(40) NOT NULL,
  worker_id VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  rendered_content MEDIUMTEXT NULL,
  file_path VARCHAR(500) NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  signed_at TIMESTAMP NULL,
  declined_at TIMESTAMP NULL,
  signature_data MEDIUMTEXT NULL,
  signer_ip VARCHAR(64) NULL,
  created_by_admin_id INT NULL
);
