-- Intentionally blank by design for the Phase 5 Step 3 deployment:
-- no species, no species_profile, no weekly_targets, no fridge_buffer,
-- no batches, no tasks. Operators add their own data via the Settings
-- UI / Onboarding flow on first boot.
--
-- The ONE exception is the `hardware_settings` row below: the engine
-- reads this table on every request (`scheduler/run`, `/tasks/today`,
-- `/tasks/complete`, `/scheduler/horizon`). Booting with zero physical
-- constraints would silently break the 1-PC-run-per-day cap and the
-- horizon bound, so we ship a single baseline row that matches the
-- schema's DEFAULTs (the INSERT below explicitly mirrors every column).
--
-- Refactor Sprint 2 — Step 1: this file is now wired into
-- `server/src/db/database.ts::migrate()`. The runner is idempotent
-- (it short-circuits if any active hardware_settings row already
-- exists), so this file is safe to re-execute on every boot.

-- ─────────────────────────────────────────────────────────────
-- Default hardware profile
-- ─────────────────────────────────────────────────────────────

INSERT INTO hardware_settings (
  profile_name,
  max_pc_runs_per_day,
  max_bags_per_pc_run,
  grain_cycle_mins,
  grain_prep_cool_mins,
  bulk_cycle_mins,
  bulk_prep_cool_mins,
  microlab_cycle_mins,
  microlab_prep_cool_mins,
  homogeneous_by_bag_type,
  daily_available_mins,
  scheduling_horizon_days,
  lab_days,
  pc_unit_count,
  default_bag_weight_lbs,
  is_active
) VALUES (
  'default',
  1,    -- max_pc_runs_per_day  (Phase 1 baseline: 1 PC run per day)
  4,    -- max_bags_per_pc_run
  150,  -- grain_cycle_mins
  90,   -- grain_prep_cool_mins
  150,  -- bulk_cycle_mins
  90,   -- bulk_prep_cool_mins
  30,   -- microlab_cycle_mins
  45,   -- microlab_prep_cool_mins
  1,    -- homogeneous_by_bag_type (Q1 — permanently TRUE)
  480,  -- daily_available_mins (Q4 — soft 8h daily budget)
  28,   -- scheduling_horizon_days (Phase 5 fallback; engine may override dynamically)
  '[1,2,3,4,5,6]', -- lab_days (Mon–Sat)
  1,    -- pc_unit_count
  5.0,  -- default_bag_weight_lbs
  1     -- is_active
);