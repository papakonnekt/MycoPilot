-- =============================================================
-- MycoScheduler — Full Database Schema
-- SQLite-compatible (better-sqlite3)
-- Reflects all design decisions from Q&A session
-- =============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────
-- REFERENCE / CONFIGURATION
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS species (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  common_name             TEXT NOT NULL,
  scientific_name         TEXT,
  -- Substrate preference
  substrate_type          TEXT NOT NULL CHECK(substrate_type IN ('HWFP','CVG','GRAIN','MIXED','CUSTOM')),
  bulk_prep_method        TEXT NOT NULL DEFAULT 'PC'
                          CHECK(bulk_prep_method IN ('PC','PASTEURIZE','NONE')),
  -- Aggregate LC tracking (Q5: per-species, not per-jar)
  lc_volume_ml_available  REAL NOT NULL DEFAULT 0,
  lc_injection_volume_ml  REAL NOT NULL DEFAULT 10.0,
  lc_restock_threshold_ml REAL NOT NULL DEFAULT 20.0,
  default_recipe_id       INTEGER REFERENCES substrate_recipe(id),
  notes                   TEXT,
  is_active               INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS species_profile (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id                   INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  -- Biological timelines (days)
  lc_to_gen1_days_min          INTEGER NOT NULL,
  lc_to_gen1_days_max          INTEGER NOT NULL,
  gen2_colonization_days_min   INTEGER NOT NULL,
  gen2_colonization_days_max   INTEGER NOT NULL,
  bulk_colonization_days_min   INTEGER NOT NULL,
  bulk_colonization_days_max   INTEGER NOT NULL,
  fruiting_days_min            INTEGER NOT NULL,
  fruiting_days_max            INTEGER NOT NULL,
  -- Expansion ratios
  gen1_to_gen2_ratio           INTEGER NOT NULL DEFAULT 10,
  gen2_to_bulk_spawn_pct       REAL    NOT NULL DEFAULT 0.20,
  -- Senescence parameters
  target_biological_efficiency REAL    NOT NULL DEFAULT 0.50,
  senescence_threshold_pct     REAL    NOT NULL DEFAULT 0.20,
  max_generations              INTEGER NOT NULL DEFAULT 8,
  -- Spore collection frequency (every Nth fruiting batch)
  spore_clone_freq             INTEGER NOT NULL DEFAULT 3,
  priority_level               INTEGER NOT NULL DEFAULT 5,
  flush_rest_days              INTEGER NOT NULL DEFAULT 7,
  -- Version control
  effective_from               TEXT    NOT NULL DEFAULT (date('now')),
  effective_to                 TEXT,
  UNIQUE(species_id, effective_from)
);

CREATE TABLE IF NOT EXISTS hardware_settings (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_name                TEXT NOT NULL DEFAULT 'default',
  -- PC capacity
  max_pc_runs_per_day         INTEGER NOT NULL DEFAULT 1,
  max_bags_per_pc_run         INTEGER NOT NULL DEFAULT 4,
  -- Grain/Bulk sterilization cycle
  grain_cycle_mins            INTEGER NOT NULL DEFAULT 150,
  grain_prep_cool_mins        INTEGER NOT NULL DEFAULT 90,
  -- Bulk sterilization cycle (may differ from grain)
  bulk_cycle_mins             INTEGER NOT NULL DEFAULT 150,
  bulk_prep_cool_mins         INTEGER NOT NULL DEFAULT 90,
  -- Micro-lab cycle (agar/LC prep)
  microlab_cycle_mins         INTEGER NOT NULL DEFAULT 30,
  microlab_prep_cool_mins     INTEGER NOT NULL DEFAULT 45,
  -- Constraints
  -- Q1: homogeneous = bag-type only (grain vs bulk), not per-species
  -- This is permanently TRUE and encoded in the packer logic
  homogeneous_by_bag_type     INTEGER NOT NULL DEFAULT 1,
  -- Q4: soft budget (warn, don't block)
  daily_available_mins        INTEGER NOT NULL DEFAULT 480,
  scheduling_horizon_days     INTEGER NOT NULL DEFAULT 28,
  lab_days                    TEXT    NOT NULL DEFAULT '[1,2,3,4,5,6]', -- JSON array 0-6
  pc_unit_count               INTEGER NOT NULL DEFAULT 1,
  is_active                   INTEGER NOT NULL DEFAULT 1,
  updated_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fridge_thresholds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id         INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  min_gen2_bags      INTEGER NOT NULL DEFAULT 2,
  target_gen2_bags   INTEGER NOT NULL DEFAULT 5,
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(species_id)
);

CREATE TABLE IF NOT EXISTS weekly_targets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id            INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  target_blocks_per_wk  INTEGER NOT NULL DEFAULT 1,
  target_weight_grams   REAL,
  week_start_date       TEXT    NOT NULL DEFAULT (date('now', 'weekday 0', '-6 days')),
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────
-- GENETICS & LINEAGE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lineage (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id            INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  lineage_code          TEXT    NOT NULL UNIQUE,  -- e.g., "JF-L001"
  origin_type           TEXT    NOT NULL
                        CHECK(origin_type IN ('SPORE_PRINT','CLONE','COMMERCIAL_LC','AGAR')),
  gen0_date             TEXT,
  generation_count      INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  is_senescent          INTEGER NOT NULL DEFAULT 0,
  senescence_flagged_at TEXT,
  history_json          TEXT,
  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS genetic_material (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  lineage_id            INTEGER NOT NULL REFERENCES lineage(id) ON DELETE CASCADE,
  species_id            INTEGER NOT NULL REFERENCES species(id),
  batch_id              TEXT    NOT NULL UNIQUE,
  material_type         TEXT    NOT NULL
                        CHECK(material_type IN ('SPORE_PRINT','AGAR_PLATE','LC_JAR','LC_SYRINGE')),
  -- Q5: volume_ml used for LC aggregate tracking at species level
  -- Individual entries still exist for audit; species.lc_volume_ml_available is the live count
  volume_ml_at_creation REAL,
  unit_count            INTEGER NOT NULL DEFAULT 1,
  status                TEXT    NOT NULL DEFAULT 'ACTIVE'
                        CHECK(status IN ('ACTIVE','DEPLETED','CONTAMINATED','ARCHIVED')),
  created_at            TEXT    NOT NULL,
  expires_at            TEXT,
  storage_location      TEXT,
  notes                 TEXT
);

-- ─────────────────────────────────────────────────────────────
-- SUBSTRATE RECIPES
-- Named recipes decoupled from species (e.g. "HWFP + 10% Wheat Bran")
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS substrate_recipe (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,  -- e.g. "HWFP Base", "HWFP + Wheat Bran 10%"
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id     INTEGER NOT NULL REFERENCES substrate_recipe(id) ON DELETE CASCADE,
  ingredient    TEXT    NOT NULL,   -- e.g. "HWFP", "Wheat Bran", "Soy Hulls"
  amount        REAL,               -- generic amount (replaces percentage)
  unit          TEXT,               -- e.g. "% by weight", "cups per bag"
  notes         TEXT
);

-- ─────────────────────────────────────────────────────────────
-- PRODUCTION PIPELINE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pc_run (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id              TEXT    NOT NULL UNIQUE,
  -- Q1: run_type = bag-type (GRAIN | BULK | MICROLAB)
  -- Cross-species grain bags can share; bulk bags can share; MICROLAB never mixes
  run_type              TEXT    NOT NULL
                        CHECK(run_type IN ('GRAIN','BULK','MICROLAB')),
  scheduled_date        TEXT    NOT NULL,
  scheduled_start_time  TEXT,
  status                TEXT    NOT NULL DEFAULT 'SCHEDULED'
                        CHECK(status IN ('SCHEDULED','IN_PROGRESS','COMPLETE','FAILED')),
  bag_count             INTEGER NOT NULL,
  cycle_duration_mins   INTEGER NOT NULL,
  total_time_mins       INTEGER NOT NULL,
  completed_at          TEXT,
  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pc_run_slot (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pc_run_id   INTEGER NOT NULL REFERENCES pc_run(id) ON DELETE CASCADE,
  species_id  INTEGER REFERENCES species(id),
  -- bag_type further distinguishes what's in each slot
  bag_type    TEXT    NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS batch (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id          TEXT    NOT NULL UNIQUE,
  species_id        INTEGER NOT NULL REFERENCES species(id),
  lineage_id        INTEGER REFERENCES lineage(id),
  parent_batch_id   INTEGER REFERENCES batch(id),         -- G2G parent
  source_pc_run_id  INTEGER REFERENCES pc_run(id),        -- Which PC run
  source_genetic_id INTEGER REFERENCES genetic_material(id), -- Which LC
  recipe_id         INTEGER REFERENCES substrate_recipe(id),  -- Substrate recipe used
  stage             TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'INCUBATING'
                    CHECK(status IN (
                      'INCUBATING','COLONIZED','IN_FRIDGE','FRUITING',
                      'HARVESTED','SPENT','CONTAMINATED','DISPOSED','EXPIRED'
                    )),
  quantity          INTEGER NOT NULL,
  weight_per_bag_lbs REAL,
  contamination_type TEXT CHECK(contamination_type IN ('TRICH','BACTERIA','MOLD','WET_ROT','UNKNOWN')),
  contamination_qty  INTEGER,  -- How many bags contaminated (may be partial)
  contaminated_at    TEXT,
  colonization_start   TEXT,
  colonization_target  TEXT,   -- start + species_profile.days_max (conservative)
  fruiting_start       TEXT,
  fruiting_target_end  TEXT,
  flush_count          INTEGER NOT NULL DEFAULT 0,
  is_deleted           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bag_unit (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bag_id           TEXT    NOT NULL UNIQUE,
  batch_id         INTEGER NOT NULL REFERENCES batch(id) ON DELETE CASCADE,
  status           TEXT    NOT NULL DEFAULT 'INCUBATING'
                   CHECK(status IN (
                     'INCUBATING','COLONIZED','IN_FRIDGE','FRUITING',
                     'HARVESTED','SPENT','CONTAMINATED','DISPOSED'
                   )),
  contam_type      TEXT    CHECK(contam_type IN ('TRICH','BACTERIA','MOLD','UNKNOWN')),
  contam_logged_at TEXT,
  notes            TEXT
);

-- ─────────────────────────────────────────────────────────────
-- FRIDGE BUFFER
-- Q2: 90-day expiry enforced via date_expires computed on insert
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fridge_buffer (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id          INTEGER NOT NULL REFERENCES species(id),
  batch_id            INTEGER NOT NULL REFERENCES batch(id),
  quantity_available  INTEGER NOT NULL,
  reserved_quantity   INTEGER NOT NULL DEFAULT 0,
  date_added          TEXT    NOT NULL DEFAULT (date('now')),
  -- Q2: 90-day shelf-life hard-coded
  date_expires        TEXT    NOT NULL DEFAULT (date('now', '+90 days')),
  notes               TEXT,
  UNIQUE(species_id, batch_id)
);

-- Fast lookup view — excludes expired bags
CREATE VIEW IF NOT EXISTS fridge_summary AS
SELECT
  fb.species_id,
  s.common_name,
  SUM(fb.quantity_available - fb.reserved_quantity)    AS net_available,
  COUNT(*)                                             AS batch_count,
  MIN(fb.date_expires)                                 AS earliest_expiry,
  ft.min_gen2_bags,
  ft.target_gen2_bags,
  CASE
    WHEN SUM(fb.quantity_available - fb.reserved_quantity) < COALESCE(ft.min_gen2_bags, 2)
    THEN 1 ELSE 0
  END AS below_threshold
FROM fridge_buffer fb
JOIN species s ON s.id = fb.species_id
LEFT JOIN fridge_thresholds ft ON ft.species_id = fb.species_id
WHERE (fb.quantity_available - fb.reserved_quantity) > 0
  AND fb.date_expires > date('now')
GROUP BY fb.species_id;

-- ─────────────────────────────────────────────────────────────
-- HARVEST & QUALITY TRACKING
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS harvest_record (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id              INTEGER NOT NULL REFERENCES batch(id),
  bag_unit_id           INTEGER REFERENCES bag_unit(id),
  lineage_id            INTEGER NOT NULL REFERENCES lineage(id),
  flush_number          INTEGER NOT NULL DEFAULT 1,
  harvest_date          TEXT    NOT NULL,
  wet_weight_grams      REAL    NOT NULL,
  dry_weight_grams      REAL,
  block_weight_grams    REAL,
  -- Biological Efficiency = wet_weight / block_weight
  biological_efficiency REAL    GENERATED ALWAYS AS (
    CASE WHEN block_weight_grams > 0
    THEN ROUND(wet_weight_grams / block_weight_grams, 4)
    ELSE NULL END
  ) STORED,
  notes                 TEXT
);

CREATE TABLE IF NOT EXISTS contam_log (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  bag_unit_id          INTEGER REFERENCES bag_unit(id),
  batch_id             INTEGER NOT NULL REFERENCES batch(id),
  pc_run_id            INTEGER REFERENCES pc_run(id),
  source_genetic_id    INTEGER REFERENCES genetic_material(id),
  lineage_id           INTEGER REFERENCES lineage(id),
  contam_type          TEXT    CHECK(contam_type IN ('TRICH','BACTERIA','MOLD','UNKNOWN')),
  -- At what stage was contamination found?
  contam_stage         TEXT    CHECK(contam_stage IN (
                         'POST_STERILIZATION','POST_INOCULATION','INCUBATION','FRUITING'
                       )),
  logged_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  notes                TEXT
);

-- ─────────────────────────────────────────────────────────────
-- TASK SCHEDULER OUTPUT
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  task_date             TEXT    NOT NULL,
  task_type             TEXT    NOT NULL,
  -- Full list of task types:
  -- Production: PC_RUN_GRAIN, PC_RUN_BULK, PC_RUN_MICROLAB
  --             INOCULATE_GEN1, G2G_TRANSFER, INOCULATE_BULK
  --             PASTEURIZE_BULK_CVG, LOAD_FRUITING_CHAMBER
  --             START_FRUITING, HARVEST, MARK_SPENT_TOSS, MOVE_TO_FRIDGE
  -- Genetics:   PREP_LC, PREP_AGAR, INOCULATE_LC
  --             COLLECT_SPORE_PRINT, CLONE_BEST_CLUSTER
  --             START_NEW_LC_FROM_SPORE, FLAG_SENESCENCE
  -- Supply:     REORDER_MATERIAL
  -- Review:     REVIEW_BATCH, OVER_BUDGET_FLAG
  title                 TEXT    NOT NULL,
  description           TEXT,
  species_id            INTEGER REFERENCES species(id),
  batch_id              INTEGER REFERENCES batch(id),
  pc_run_id             INTEGER REFERENCES pc_run(id),
  lineage_id            INTEGER REFERENCES lineage(id),
  estimated_mins        INTEGER,
  -- Q4: Soft budget — status can be OVER_BUDGET_WARNING but task always scheduled
  status                TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK(status IN (
                          'PENDING','IN_PROGRESS','BLOCKED','COMPLETE','SKIPPED',
                          'RESCHEDULED','FLAGGED','OVER_BUDGET_WARNING'
                        )),
  flush_number          INTEGER,             -- For HARVEST tasks
  depends_on_task_id    INTEGER REFERENCES task(id),
  depends_on_batch_id   INTEGER REFERENCES batch(id), -- For flush kill cascade
  blocked_by_task_id    INTEGER REFERENCES task(id),
  is_auto_generated     INTEGER NOT NULL DEFAULT 1,
  is_deleted            INTEGER NOT NULL DEFAULT 0,
  rescheduled_from_date TEXT,
  in_progress_started_at TEXT,
  completed_at          TEXT,
  created_by            TEXT    NOT NULL DEFAULT 'SCHEDULER',
  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_date ON task(task_date);
CREATE INDEX IF NOT EXISTS idx_task_type ON task(task_type);
CREATE INDEX IF NOT EXISTS idx_task_batch ON task(batch_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);

CREATE TABLE IF NOT EXISTS schedule_run_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  horizon_start     TEXT    NOT NULL,
  horizon_end       TEXT    NOT NULL,
  tasks_generated   INTEGER NOT NULL DEFAULT 0,
  tasks_deleted     INTEGER NOT NULL DEFAULT 0,
  warnings_json     TEXT,   -- JSON array of SchedulerWarning objects
  triggered_by      TEXT    NOT NULL
                    CHECK(triggered_by IN ('USER','SETTINGS_CHANGE','TASK_COMPLETE','CRON'))
);

-- ─────────────────────────────────────────────────────────────
-- RAW MATERIAL INVENTORY
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_material (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  material_name      TEXT    NOT NULL UNIQUE,
  unit               TEXT    NOT NULL CHECK(unit IN ('lbs','kg','bricks','units','mL','bags')),
  quantity_on_hand   REAL    NOT NULL DEFAULT 0,
  reorder_threshold  REAL    NOT NULL,
  reorder_quantity   REAL    NOT NULL,
  cost_per_unit      REAL,
  supplier_name      TEXT,
  notes              TEXT,
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Defines how much material each task type consumes per bag/block
CREATE TABLE IF NOT EXISTS material_usage_recipe (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type         TEXT    NOT NULL,
  material_id       INTEGER NOT NULL REFERENCES raw_material(id),
  quantity_per_bag  REAL    NOT NULL,
  notes             TEXT,
  UNIQUE(task_type, material_id)
);

CREATE TABLE IF NOT EXISTS material_transaction (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id      INTEGER NOT NULL REFERENCES raw_material(id),
  transaction_type TEXT    NOT NULL
                   CHECK(transaction_type IN ('RESTOCK','CONSUMED','ADJUSTMENT','EXPIRED','WASTE')),
  quantity         REAL    NOT NULL,  -- Positive=in, Negative=out
  related_task_id  INTEGER REFERENCES task(id),
  related_batch_id INTEGER REFERENCES batch(id),
  transaction_date TEXT    NOT NULL DEFAULT (datetime('now')),
  notes            TEXT
);

-- ─────────────────────────────────────────────────────────────
-- PASTEURIZATION EVENTS (CVG — Pink Oyster, not PC'd)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pasteurization_event (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       TEXT    NOT NULL UNIQUE,
  species_id     INTEGER NOT NULL REFERENCES species(id),
  scheduled_date TEXT    NOT NULL,
  substrate_type TEXT    NOT NULL DEFAULT 'CVG',
  bag_count      INTEGER NOT NULL,
  method         TEXT    NOT NULL DEFAULT 'STOVETOP',
  estimated_mins INTEGER NOT NULL DEFAULT 60,
  status         TEXT    NOT NULL DEFAULT 'SCHEDULED'
                 CHECK(status IN ('SCHEDULED','COMPLETE','FAILED')),
  completed_at   TEXT,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────
-- AUDIT LOG & TELEMETRY
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type    TEXT    NOT NULL,
  entity_id      TEXT    NOT NULL,
  action         TEXT    NOT NULL,
  state_before   TEXT,
  state_after    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by     TEXT    NOT NULL DEFAULT 'SYSTEM'
);

-- Protocol library
CREATE TABLE IF NOT EXISTS protocol (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id     INTEGER REFERENCES species(id),
  name           TEXT    NOT NULL,
  content_md     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Batch photos
CREATE TABLE IF NOT EXISTS batch_photo (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       INTEGER NOT NULL REFERENCES batch(id) ON DELETE CASCADE,
  file_path      TEXT    NOT NULL,
  captured_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  notes          TEXT
);
