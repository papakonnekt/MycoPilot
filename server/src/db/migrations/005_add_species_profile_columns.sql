ALTER TABLE species_profile ADD COLUMN priority_level INTEGER NOT NULL DEFAULT 5;
ALTER TABLE species_profile ADD COLUMN flush_rest_days INTEGER NOT NULL DEFAULT 7;
