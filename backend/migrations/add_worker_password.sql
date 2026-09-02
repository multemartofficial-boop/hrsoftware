-- Add password_hash column to workers table
ALTER TABLE workers ADD COLUMN password_hash VARCHAR(255) NULL AFTER status;

-- Fix attendance table to allow NULL check_out_time for open check-ins
ALTER TABLE attendance MODIFY COLUMN check_out_time TIME NULL;
