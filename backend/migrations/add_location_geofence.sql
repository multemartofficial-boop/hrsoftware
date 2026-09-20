-- Phase E Part 1: geofenced check-in
-- Locations get a GPS anchor plus allowed radius
-- Attendance stores the worker captured GPS and a mismatch flag
ALTER TABLE locations
  ADD COLUMN latitude DECIMAL(10,7) NULL,
  ADD COLUMN longitude DECIMAL(10,7) NULL,
  ADD COLUMN radius_meters INT NOT NULL DEFAULT 25;

ALTER TABLE attendance
  ADD COLUMN check_in_lat DECIMAL(10,7) NULL,
  ADD COLUMN check_in_lng DECIMAL(10,7) NULL,
  ADD COLUMN location_mismatch TINYINT(1) NOT NULL DEFAULT 0;
