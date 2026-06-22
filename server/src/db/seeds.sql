-- =============================================================
-- MycoScheduler — Seed Data
-- Default species, hardware settings, and raw materials
-- Reflects the 4 target species from the spec
-- =============================================================

-- Default hardware settings (1 PC/day, 4 bags/run)
INSERT INTO hardware_settings (
  profile_name, max_pc_runs_per_day, max_bags_per_pc_run,
  grain_cycle_mins, grain_prep_cool_mins,
  bulk_cycle_mins, bulk_prep_cool_mins,
  microlab_cycle_mins, microlab_prep_cool_mins,
  homogeneous_by_bag_type, daily_available_mins, scheduling_horizon_days
) VALUES (
  'default', 1, 4,
  150, 90,
  150, 90,
  30, 45,
  1, 480, 28
);

-- ─────────────────────────────────────────────────────────────
-- SPECIES
-- ─────────────────────────────────────────────────────────────

INSERT INTO species (common_name, scientific_name, substrate_type, bulk_prep_method,
  lc_volume_ml_available, lc_injection_volume_ml, lc_restock_threshold_ml)
VALUES
  -- Jack Frost (high-volume woodlover, HWFP, PC'd)
  ('Jack Frost', 'Pleurotus ostreatus var.', 'HWFP', 'PC',
   100, 10.0, 20.0),

  -- Lion''s Mane (low-volume medicinal, HWFP, PC'd)
  ('Lion''s Mane', 'Hericium erinaceus', 'HWFP', 'PC',
   100, 10.0, 20.0),

  -- Pink Oyster (fast fruiter, CVG pasteurized)
  ('Pink Oyster', 'Pleurotus djamor', 'CVG', 'PASTEURIZE',
   100, 10.0, 20.0),

  -- Cordyceps (grain-based, no bulk substrate)
  ('Cordyceps', 'Cordyceps militaris', 'GRAIN', 'NONE',
   100, 10.0, 20.0);

-- ─────────────────────────────────────────────────────────────
-- SPECIES PROFILES (biological timelines)
-- Conservative (max) values used for scheduling deadlines
-- ─────────────────────────────────────────────────────────────

-- Jack Frost: fast woodlover, 1:10 G2G ratio, 20% spawn
INSERT INTO species_profile (
  species_id,
  lc_to_gen1_days_min, lc_to_gen1_days_max,
  gen2_colonization_days_min, gen2_colonization_days_max,
  bulk_colonization_days_min, bulk_colonization_days_max,
  fruiting_days_min, fruiting_days_max,
  gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct,
  target_biological_efficiency, senescence_threshold_pct,
  max_generations, spore_clone_freq
)
VALUES (
  (SELECT id FROM species WHERE common_name = 'Jack Frost'),
  12, 18,
  12, 16,
  12, 16,
  5, 10,
  10, 0.20,
  0.50, 0.20,
  8, 3
);

-- Lion's Mane: slower colonizer, 1:10 G2G, 20% spawn
INSERT INTO species_profile (
  species_id,
  lc_to_gen1_days_min, lc_to_gen1_days_max,
  gen2_colonization_days_min, gen2_colonization_days_max,
  bulk_colonization_days_min, bulk_colonization_days_max,
  fruiting_days_min, fruiting_days_max,
  gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct,
  target_biological_efficiency, senescence_threshold_pct,
  max_generations, spore_clone_freq
)
VALUES (
  (SELECT id FROM species WHERE common_name = 'Lion''s Mane'),
  14, 21,
  14, 21,
  14, 21,
  7, 14,
  10, 0.20,
  0.60, 0.20,
  6, 2
);

-- Pink Oyster: fast colonizer, CVG, 1:8 G2G
INSERT INTO species_profile (
  species_id,
  lc_to_gen1_days_min, lc_to_gen1_days_max,
  gen2_colonization_days_min, gen2_colonization_days_max,
  bulk_colonization_days_min, bulk_colonization_days_max,
  fruiting_days_min, fruiting_days_max,
  gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct,
  target_biological_efficiency, senescence_threshold_pct,
  max_generations, spore_clone_freq
)
VALUES (
  (SELECT id FROM species WHERE common_name = 'Pink Oyster'),
  7, 14,
  7, 12,
  5, 10,
  3, 7,
  8, 0.40,
  0.75, 0.20,
  10, 5
);

-- Cordyceps: slow colonizer, grain-only, 1:6 G2G
INSERT INTO species_profile (
  species_id,
  lc_to_gen1_days_min, lc_to_gen1_days_max,
  gen2_colonization_days_min, gen2_colonization_days_max,
  bulk_colonization_days_min, bulk_colonization_days_max,
  fruiting_days_min, fruiting_days_max,
  gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct,
  target_biological_efficiency, senescence_threshold_pct,
  max_generations, spore_clone_freq
)
VALUES (
  (SELECT id FROM species WHERE common_name = 'Cordyceps'),
  21, 28,
  21, 28,
  21, 28,
  21, 35,
  6, 0.33,
  0.30, 0.20,
  8, 2
);

-- ─────────────────────────────────────────────────────────────
-- FRIDGE THRESHOLDS
-- ─────────────────────────────────────────────────────────────

INSERT INTO fridge_thresholds (species_id, min_gen2_bags, target_gen2_bags)
VALUES
  ((SELECT id FROM species WHERE common_name = 'Jack Frost'),   3, 6),
  ((SELECT id FROM species WHERE common_name = 'Lion''s Mane'), 2, 4),
  ((SELECT id FROM species WHERE common_name = 'Pink Oyster'),  2, 4),
  ((SELECT id FROM species WHERE common_name = 'Cordyceps'),    2, 4);

-- ─────────────────────────────────────────────────────────────
-- WEEKLY TARGETS (example from spec)
-- ─────────────────────────────────────────────────────────────

INSERT INTO weekly_targets (species_id, target_blocks_per_wk, is_active)
VALUES
  ((SELECT id FROM species WHERE common_name = 'Jack Frost'),   10, 1),
  ((SELECT id FROM species WHERE common_name = 'Lion''s Mane'),  1, 1),
  ((SELECT id FROM species WHERE common_name = 'Pink Oyster'),   1, 1),
  ((SELECT id FROM species WHERE common_name = 'Cordyceps'),     1, 1);

-- ─────────────────────────────────────────────────────────────
-- RAW MATERIALS
-- ─────────────────────────────────────────────────────────────

INSERT INTO raw_material (material_name, unit, quantity_on_hand, reorder_threshold, reorder_quantity, notes)
VALUES
  ('Rye Grain',         'lbs',    25,  10, 50, 'For Gen1 and Gen2 grain bags'),
  ('Hard Winter Wheat', 'lbs',    25,  10, 50, 'Alternative grain substrate'),
  ('HWFP',              'lbs',    50,  20, 50, 'Hardwood fuel pellets — bulk substrate for woodlovers'),
  ('Coco Coir',         'bricks', 10,   4, 20, 'CVG component — for Pink Oyster'),
  ('Vermiculite',       'lbs',    10,   4, 20, 'CVG component — field capacity adjustment'),
  ('Gypsum',            'lbs',     5,   2, 10, 'CVG component — pH and structure'),
  ('Soy Hulls',         'lbs',    10,   4, 20, 'Nitrogen supplement for some bulk substrates'),
  ('Grain Bags (P+F)',  'units', 200,  50,200, '0.2 micron filtered poly bags for grain'),
  ('Bulk Bags (P+F)',   'units', 100,  25,100, 'Large filter patch bags for bulk blocks'),
  ('LC Broth Mix',      'units',  20,   5, 20, 'Karo/Honey/LME broth mix for LC jars'),
  ('Agar Powder',       'units',  10,   3, 10, 'MEA or PDYA powder for plates'),
  ('Pressure Gauge Seals', 'units', 10, 3, 10, 'PC maintenance parts');

-- ─────────────────────────────────────────────────────────────
-- MATERIAL USAGE RECIPES
-- (how much raw material each task type consumes per bag)
-- ─────────────────────────────────────────────────────────────

-- PC_RUN_GRAIN (grain bags): ~0.5 lbs grain + 1 bag per bag sterilized
INSERT INTO material_usage_recipe (task_type, material_id, quantity_per_bag, notes)
VALUES
  ('PC_RUN_GRAIN',
   (SELECT id FROM raw_material WHERE material_name = 'Rye Grain'),
   0.5, '0.5 lbs dry grain per grain bag'),
  ('PC_RUN_GRAIN',
   (SELECT id FROM raw_material WHERE material_name = 'Grain Bags (P+F)'),
   1, '1 filtered bag per grain bag slot');

-- PC_RUN_BULK (HWFP blocks): ~2.5 lbs HWFP + 1 bag per block
INSERT INTO material_usage_recipe (task_type, material_id, quantity_per_bag, notes)
VALUES
  ('PC_RUN_BULK',
   (SELECT id FROM raw_material WHERE material_name = 'HWFP'),
   2.5, '2.5 lbs HWFP per fruiting block'),
  ('PC_RUN_BULK',
   (SELECT id FROM raw_material WHERE material_name = 'Bulk Bags (P+F)'),
   1, '1 large filter patch bag per block');

-- PASTEURIZE_BULK_CVG: coco coir + vermiculite + gypsum + 1 bag
INSERT INTO material_usage_recipe (task_type, material_id, quantity_per_bag, notes)
VALUES
  ('PASTEURIZE_BULK_CVG',
   (SELECT id FROM raw_material WHERE material_name = 'Coco Coir'),
   0.5, '0.5 bricks coco coir per CVG block (approx)'),
  ('PASTEURIZE_BULK_CVG',
   (SELECT id FROM raw_material WHERE material_name = 'Vermiculite'),
   0.5, '0.5 lbs vermiculite per CVG block'),
  ('PASTEURIZE_BULK_CVG',
   (SELECT id FROM raw_material WHERE material_name = 'Gypsum'),
   0.1, '0.1 lbs gypsum per CVG block'),
  ('PASTEURIZE_BULK_CVG',
   (SELECT id FROM raw_material WHERE material_name = 'Bulk Bags (P+F)'),
   1, '1 large bag per CVG block');

-- PC_RUN_MICROLAB (LC jars): broth + jar capacity
INSERT INTO material_usage_recipe (task_type, material_id, quantity_per_bag, notes)
VALUES
  ('PC_RUN_MICROLAB',
   (SELECT id FROM raw_material WHERE material_name = 'LC Broth Mix'),
   1, '1 unit broth mix per LC jar');
