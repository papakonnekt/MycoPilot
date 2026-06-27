ALTER TABLE hardware_settings ADD COLUMN lab_days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]';
ALTER TABLE hardware_settings ADD COLUMN default_bag_weight_lbs REAL NOT NULL DEFAULT 5.0;
