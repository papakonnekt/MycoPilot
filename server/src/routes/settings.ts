import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { TargetInterval } from '../../../shared/types';

const router = Router();

/**
 * Normalize a free-form cadence value to the canonical enum.
 * Defaults to 'WEEKLY' for unknown / missing values so legacy rows keep
 * working — Phase 5 row mapper does the same on read.
 */
function normalizeInterval(raw: unknown): TargetInterval {
  return raw === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY';
}

// ── GET /api/settings ─────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const hw = db.prepare(`SELECT * FROM hardware_settings WHERE is_active = 1 LIMIT 1`).get();
    
    if (!hw) {
      return res.json({ success: true, data: { isSetup: false } });
    }

    const species = db.prepare(`
      SELECT s.*, sp.*,
        COALESCE((SELECT SUM(unit_count) FROM genetic_material gm WHERE gm.species_id = s.id AND gm.material_type = 'AGAR_PLATE' AND gm.status = 'ACTIVE'), 0) AS agar_plates,
        COALESCE((SELECT SUM(unit_count) FROM genetic_material gm WHERE gm.species_id = s.id AND gm.material_type = 'SPORE_PRINT' AND gm.status = 'ACTIVE'), 0) AS spore_prints
      FROM species s
      LEFT JOIN species_profile sp ON sp.species_id = s.id AND sp.effective_to IS NULL
      WHERE s.is_active = 1
    `).all();
    const thresholds = db.prepare(`
      SELECT ft.*, s.common_name
      FROM fridge_thresholds ft
      JOIN species s ON s.id = ft.species_id
    `).all();
    const targets = db.prepare(`
      SELECT wt.*, s.common_name
      FROM weekly_targets wt
      JOIN species s ON s.id = wt.species_id
      WHERE wt.is_active = 1
    `).all();

    res.json({ success: true, data: { isSetup: true, hardware: hw, species, fridgeThresholds: thresholds, weeklyTargets: targets } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/settings/setup ──────────────────────────────────
router.post('/setup', (req: Request, res: Response) => {
  const db = getDb();
  const s = req.body;

  try {
    const hwCheck = db.prepare(`SELECT id FROM hardware_settings WHERE is_active = 1 LIMIT 1`).get();
    if (hwCheck) {
      return res.status(400).json({ success: false, error: 'Setup is already complete. Please use management endpoints to update settings.' });
    }

    const insertHw = db.prepare(`
      INSERT INTO hardware_settings (
        max_pc_runs_per_day, max_bags_per_pc_run,
        grain_cycle_mins, grain_prep_cool_mins,
        bulk_cycle_mins, bulk_prep_cool_mins,
        microlab_cycle_mins, microlab_prep_cool_mins,
        daily_available_mins, scheduling_horizon_days,
        pc_unit_count, lab_days, default_bag_weight_lbs
      ) VALUES (
        @max_pc_runs_per_day, @max_bags_per_pc_run,
        @grain_cycle_mins, @grain_prep_cool_mins,
        @bulk_cycle_mins, @bulk_prep_cool_mins,
        @microlab_cycle_mins, @microlab_prep_cool_mins,
        @daily_available_mins, @scheduling_horizon_days,
        @pc_unit_count, @lab_days, @default_bag_weight_lbs
      )
    `);

    db.transaction(() => {
      // ── Hardware ─────────────────────────────────────────────
      const hwParams = {
        ...s.hardware,
        pc_unit_count: s.hardware.pc_unit_count ?? s.hardware.pcUnitCount ?? 1,
        lab_days: JSON.stringify(s.hardware.labDays ?? [1, 2, 3, 4, 5, 6]),
        default_bag_weight_lbs: s.hardware.defaultBagWeightLbs ?? 5.0,
        homogeneous_by_bag_type: s.hardware.homogeneous_by_bag_type ?? 1,
      };
      insertHw.run(hwParams);

      // ── Recipes (optional, sent from onboarding step 2) ──────
      const insertRecipe = db.prepare(`
        INSERT OR IGNORE INTO substrate_recipe (name, notes) VALUES (?, ?)
      `);
      const insertIngredient = db.prepare(`
        INSERT INTO recipe_ingredient (recipe_id, ingredient, percentage, unit)
        VALUES (?, ?, ?, ?)
      `);

      const recipeMap = new Map<number, number>();
      let rIdx = 0;
      for (const recipe of (s.recipes ?? [])) {
        const rr = insertRecipe.run(recipe.name, recipe.notes ?? null);
        const recipeId = rr.lastInsertRowid as number;
        recipeMap.set(rIdx, recipeId);
        for (const ing of (recipe.ingredients ?? [])) {
          insertIngredient.run(recipeId, ing.ingredient, ing.amount ?? null, ing.unit ?? null);
        }
        rIdx++;
      }

      // Prepare species statements
      const insertSpecies = db.prepare(`
        INSERT INTO species (common_name, substrate_type, bulk_prep_method, lc_volume_ml_available, default_recipe_id)
        VALUES (@commonName, 'MIXED', @bulkPrepMethod, @lcVolumeMl, @defaultRecipeId)
      `);
      
      const insertProfile = db.prepare(`
        INSERT INTO species_profile (
          species_id,
          lc_to_gen1_days_min, lc_to_gen1_days_max,
          gen2_colonization_days_min, gen2_colonization_days_max,
          bulk_colonization_days_min, bulk_colonization_days_max,
          fruiting_days_min, fruiting_days_max,
          gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct,
          target_biological_efficiency, senescence_threshold_pct,
          max_generations, spore_clone_freq, priority_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Phase 5 Step 2: target_interval (WEEKLY|MONTHLY) carries through
      // the setup flow. Onboarding allows the user to pick cadence per
      // species — the value is normalised by the route before the INSERT.
      const insertTargets = db.prepare(`
        INSERT INTO weekly_targets (species_id, target_blocks_per_wk, target_interval) VALUES (?, ?, ?)
      `);

      const insertFridge = db.prepare(`
        INSERT INTO fridge_thresholds (species_id, min_gen2_bags, target_gen2_bags) VALUES (?, ?, ?)
      `);

      const insertLineage = db.prepare(`
        INSERT INTO lineage (species_id, lineage_code, origin_type, generation_count)
        VALUES (?, ?, 'COMMERCIAL_LC', 0)
      `);

      const insertRawMaterial = db.prepare(`
        INSERT INTO raw_material (material_name, unit, quantity_on_hand, reorder_threshold, reorder_quantity, notes)
        VALUES (?, ?, ?, 0, 0, ?)
      `);

      const insertBatch = db.prepare(`
        INSERT INTO batch (batch_id, species_id, lineage_id, stage, status, quantity, colonization_start, colonization_target)
        VALUES (?, ?, ?, ?, 'INCUBATING', ?, ?, ?)
      `);

      for (const sp of s.species) {
        // 1. Insert Species (substrate type is now decoupled — stored as CUSTOM)
        const result = insertSpecies.run({
          commonName: sp.commonName,
          bulkPrepMethod: sp.bulkPrepMethod || 'PC',
          lcVolumeMl: sp.startingLcVolumeMl || 0,
          defaultRecipeId: sp.defaultRecipeIdx !== undefined ? recipeMap.get(sp.defaultRecipeIdx) : null,
        });
        const speciesId = result.lastInsertRowid;
        
        // 2. Insert Profile
        insertProfile.run(
          speciesId,
          sp.lcToGen1DaysMin ?? 14, sp.lcToGen1DaysMax ?? 21,
          sp.gen2ColonizationDaysMin ?? 14, sp.gen2ColonizationDaysMax ?? 21,
          sp.bulkColonizationDaysMin ?? 14, sp.bulkColonizationDaysMax ?? 21,
          sp.fruitingDaysMin ?? 7, sp.fruitingDaysMax ?? 14,
          sp.gen1ToGen2Ratio ?? 10, sp.gen2ToBulkSpawnPct ?? 0.2,
          sp.targetBiologicalEfficiency ?? 0.5, sp.senescenceThresholdPct ?? 0.2,
          sp.maxGenerations ?? 3, sp.sporeCloneFreq ?? 3, sp.priorityLevel ?? 3
        );

        // 3. Targets & Fridge
        // Phase 5 Step 2: pass the cadence flag through; missing values
        // collapse to WEEKLY so onboarding never crashes on a partial
        // payload.
        if (sp.weeklyTargetBlocks) {
          const cadence = normalizeInterval((sp as any).targetInterval);
          insertTargets.run(speciesId, sp.weeklyTargetBlocks, cadence);
        }
        if (sp.fridgeTargetBags && sp.fridgeMinBags) insertFridge.run(speciesId, sp.fridgeMinBags, sp.fridgeTargetBags);

        // 4. Lineage Auto-Generation (e.g. "Blue Oyster" → "BO-01")
        const initials = sp.commonName.split(' ').map((w: string) => w[0]).join('').toUpperCase();
        const lineageCode = `${initials}-01`;
        const lineageResult = insertLineage.run(speciesId, lineageCode);
        const lineageId = lineageResult.lastInsertRowid;

        // 5. Raw Materials (Inventory)
        if (sp.sterilizedGrains && sp.sterilizedGrains.length > 0) {
          for (const item of sp.sterilizedGrains) {
            if (item.quantity > 0 && item.weightLbs > 0) {
              insertRawMaterial.run(
                `Sterilized Grain (${sp.commonName}) - ${item.weightLbs} lb bags`,
                'bags',
                item.quantity,
                `Ready-to-inoculate grain bags`
              );
            }
          }
        }

        if (sp.sterilizedSubstrate && sp.sterilizedSubstrate.length > 0) {
          for (const item of sp.sterilizedSubstrate) {
            if (item.quantity > 0 && item.weightLbs > 0) {
              insertRawMaterial.run(
                `Sterilized Substrate (${sp.commonName}) - ${item.weightLbs} lb bags`,
                'bags',
                item.quantity,
                `Ready-to-use substrate bags`
              );
            }
          }
        }

        // 6. Incubating Spawn (pre-existing batches from onboarding step 7)
        if (sp.incubating && sp.incubating.length > 0) {
          for (const item of sp.incubating) {
            const bId = `BATCH-INIT-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
            
            let totalDays = 14;
            if (item.stage === 'GEN1_GRAIN') totalDays = sp.lcToGen1DaysMax ?? 21;
            else if (item.stage === 'GEN2_GRAIN') totalDays = sp.gen2ColonizationDaysMax ?? 21;
            else if (item.stage === 'BULK_BLOCK') totalDays = sp.bulkColonizationDaysMax ?? 21;
            
            const pct = item.colonizationPct || 0;
            const daysAgo = (pct / 100) * totalDays;
            const targetDaysFromNow = totalDays - daysAgo;

            const startStr = new Date(Date.now() - daysAgo * 86400000).toISOString();
            const targetStr = new Date(Date.now() + targetDaysFromNow * 86400000).toISOString();

            insertBatch.run(bId, speciesId, lineageId, item.stage, item.quantity, startStr, targetStr);
          }
        }
      }
    })();

    res.json({ success: true, message: 'Setup complete.' });
  } catch (err) {
    console.error("SETUP ERROR:", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/settings/hardware ────────────────────────────────

router.put('/hardware', (req: Request, res: Response) => {
  const db = getDb();
  const s = req.body;

  try {
    db.prepare(`
      UPDATE hardware_settings SET
        max_pc_runs_per_day    = COALESCE(@max_pc_runs_per_day, max_pc_runs_per_day),
        max_bags_per_pc_run    = COALESCE(@max_bags_per_pc_run, max_bags_per_pc_run),
        grain_cycle_mins       = COALESCE(@grain_cycle_mins, grain_cycle_mins),
        grain_prep_cool_mins   = COALESCE(@grain_prep_cool_mins, grain_prep_cool_mins),
        bulk_cycle_mins        = COALESCE(@bulk_cycle_mins, bulk_cycle_mins),
        bulk_prep_cool_mins    = COALESCE(@bulk_prep_cool_mins, bulk_prep_cool_mins),
        microlab_cycle_mins    = COALESCE(@microlab_cycle_mins, microlab_cycle_mins),
        microlab_prep_cool_mins= COALESCE(@microlab_prep_cool_mins, microlab_prep_cool_mins),
        daily_available_mins   = COALESCE(@daily_available_mins, daily_available_mins),
        pc_unit_count          = COALESCE(@pc_unit_count, pc_unit_count),
        default_bag_weight_lbs = COALESCE(@default_bag_weight_lbs, default_bag_weight_lbs),
        lab_days               = COALESCE(@lab_days_str, lab_days),
        updated_at             = datetime('now')
      WHERE is_active = 1
    `).run({
      ...s,
      lab_days_str: s.lab_days ? JSON.stringify(s.lab_days) : null,
    });

    res.json({ success: true, message: 'Hardware settings updated. Re-run scheduler to apply.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /api/settings/weekly-targets -- Phase 5 Step 2 exposes the cadence
// column alongside the rest of the target row.
router.get('/weekly-targets', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT wt.*, s.common_name
      FROM weekly_targets wt
      JOIN species s ON s.id = wt.species_id
      WHERE wt.is_active = 1
      ORDER BY s.common_name
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/settings/weekly-targets ─────────────────────────
// PUT /api/settings/weekly-targets -- Phase 5 Step 2 adds the cadence flag.
router.put('/weekly-targets', (req: Request, res: Response) => {
  const db = getDb();
  const { targets } = req.body as {
    targets: Array<{
      speciesId: number;
      targetBlocksPerWk: number;
      targetInterval?: TargetInterval | string;
    }>;
  };

  try {
    const upsert = db.prepare(`
      INSERT INTO weekly_targets (species_id, target_blocks_per_wk, target_interval, is_active)
      VALUES (@speciesId, @targetBlocksPerWk, @targetInterval, 1)
      ON CONFLICT(species_id) DO UPDATE SET
        target_blocks_per_wk = excluded.target_blocks_per_wk,
        target_interval     = excluded.target_interval,
        is_active = 1
    `);

    const upsertMany = db.transaction(() => {
      for (const t of targets) {
        upsert.run({
          speciesId: t.speciesId,
          targetBlocksPerWk: t.targetBlocksPerWk,
          targetInterval: normalizeInterval(t.targetInterval),
        });
      }
    });
    upsertMany();

    res.json({ success: true, message: 'Weekly targets updated. Re-run scheduler to apply.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/settings/species/:id/protocol ────────────────────
router.put('/species/:id/protocol', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { protocol_markdown } = req.body;
  try {
    db.prepare(`UPDATE species SET protocol_markdown = ? WHERE id = ?`).run(protocol_markdown, id);
    res.json({ success: true, message: 'Protocol updated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/settings/species/:id/profile ────────────────────
router.put('/species/:id/profile', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const p = req.body;

  try {
    const runUpdate = db.transaction(() => {
      // 1. Expire current profile
      db.prepare(`UPDATE species_profile SET effective_to = date('now') WHERE species_id = ? AND effective_to IS NULL`).run(id);

      // 2. Insert new version
      db.prepare(`
        INSERT INTO species_profile (
          species_id,
          lc_to_gen1_days_min, lc_to_gen1_days_max,
          gen2_colonization_days_min, gen2_colonization_days_max,
          bulk_colonization_days_min, bulk_colonization_days_max,
          fruiting_days_min, fruiting_days_max,
          gen1_to_gen2_ratio, gen2_to_bulk_spawn_pct,
          target_biological_efficiency, senescence_threshold_pct,
          max_generations, spore_clone_freq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        p.lcToGen1DaysMin, p.lcToGen1DaysMax,
        p.gen2ColonizationDaysMin, p.gen2ColonizationDaysMax,
        p.bulkColonizationDaysMin, p.bulkColonizationDaysMax,
        p.fruitingDaysMin, p.fruitingDaysMax,
        p.gen1ToGen2Ratio, p.gen2ToBulkSpawnPct,
        p.targetBiologicalEfficiency, p.senescenceThresholdPct,
        p.maxGenerations, p.sporeCloneFreq
      );

      // 3. Update lc_injection_volume_ml in species
      if (p.lcInjectionVolumeMl !== undefined) {
        db.prepare(`UPDATE species SET lc_injection_volume_ml = ? WHERE id = ?`).run(p.lcInjectionVolumeMl, id);
      }

      // 4. Update fridge_thresholds
      if (p.minGen2Bags !== undefined || p.targetGen2Bags !== undefined) {
        db.prepare(`
          INSERT INTO fridge_thresholds (species_id, min_gen2_bags, target_gen2_bags)
          VALUES (?, ?, ?)
          ON CONFLICT(species_id) DO UPDATE SET
            min_gen2_bags = COALESCE(excluded.min_gen2_bags, fridge_thresholds.min_gen2_bags),
            target_gen2_bags = COALESCE(excluded.target_gen2_bags, fridge_thresholds.target_gen2_bags)
        `).run(id, p.minGen2Bags, p.targetGen2Bags);
      }

// 5. Update weekly_targets -- Phase 5 Step 2 also persists the cadence.
// We only touch target_interval when the client explicitly sends a value;
// missing values leave the existing row's cadence intact.
if (p.targetBlocksPerWk !== undefined || p.targetInterval !== undefined) {
  const cadence =
    p.targetInterval !== undefined
      ? normalizeInterval(p.targetInterval)
      : 'WEEKLY';
  const blocks =
    p.targetBlocksPerWk !== undefined ? p.targetBlocksPerWk : 0;
  db.prepare(`
    INSERT INTO weekly_targets (species_id, target_blocks_per_wk, target_interval, is_active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(species_id) DO UPDATE SET
      target_blocks_per_wk = COALESCE(excluded.target_blocks_per_wk, weekly_targets.target_blocks_per_wk),
      target_interval     = excluded.target_interval,
      is_active = 1
  `).run(id, blocks, cadence);
}
    });

    runUpdate();

    res.json({ success: true, message: 'Species profile and targets updated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/settings/backup ─────────────────────────────────
import fs from 'fs';
import path from 'path';

router.post('/backup', (req: Request, res: Response) => {
  try {
    const dbPath = path.resolve(__dirname, '../../data/mycolab.sqlite');
    const backupPath = path.resolve(__dirname, `../../data/mycolab_backup_${Date.now()}.sqlite`);
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
      res.json({ success: true, message: `Backup created at ${backupPath}` });
    } else {
      res.status(404).json({ success: false, error: 'Database file not found.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── POST /api/settings/reset ──────────────────────────────────
router.post('/reset', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const runReset = db.transaction(() => {
      db.prepare(`DELETE FROM task`).run();
      db.prepare(`DELETE FROM batch_photo`).run();
      db.prepare(`DELETE FROM batch`).run();
      db.prepare(`DELETE FROM pc_run`).run();
      db.prepare(`DELETE FROM lineage`).run();
      db.prepare(`DELETE FROM genetic_material`).run();
      // Reset sequences
      db.prepare(`UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('task', 'batch_photo', 'batch', 'pc_run', 'lineage', 'genetic_material')`).run();
    });
    runReset();
    res.json({ success: true, message: 'All batches, tasks, and genetic materials have been wiped. Settings and species were preserved.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
