-- Phase F fix: auto-detected check-in location
-- Stores the nearest geofenced location + distance for admin reference when
-- a worker checks in outside every radius (location stays Unknown/Unmatched)
ALTER TABLE attendance
  ADD COLUMN nearest_location VARCHAR(255) NULL,
  ADD COLUMN distance_meters INT NULL;
