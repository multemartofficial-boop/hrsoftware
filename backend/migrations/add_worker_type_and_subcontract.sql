-- Phase D: worker_type (Direct vs Sub-contract) + subcontract company name
ALTER TABLE registration_applications
  ADD COLUMN subcontract_company VARCHAR(200) NULL,
  ADD COLUMN worker_type VARCHAR(20) NOT NULL DEFAULT 'Direct';

ALTER TABLE workers
  ADD COLUMN subcontract_company VARCHAR(200) NULL,
  ADD COLUMN worker_type VARCHAR(20) NOT NULL DEFAULT 'Direct';
