-- Add target_interval column to weekly_targets
-- WEEKLY = schedule every 7 days (default)
-- MONTHLY = schedule once every 4 weeks (Monthly Rotator slot)
ALTER TABLE weekly_targets ADD COLUMN target_interval TEXT NOT NULL DEFAULT 'WEEKLY' CHECK (target_interval IN ('WEEKLY', 'MONTHLY'));