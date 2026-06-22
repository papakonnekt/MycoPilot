import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';

const router = Router();

// ── GET /api/settings ─────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const hw = db.prepare(`SELECT * FROM hardware_settings WHERE is_active = 1 LIMIT 1`).get();
    
    if (!hw) {
      return res.json({ success: true, data: { isSetup: false } });
    }

    const species = db.prepare(`
      SELECT s.*, sp.*
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
    const insertHw = db.prepare(`
      INSERT INTO hardware_settings (
        max_pc_runs_per_day, max_bags_per_pc_run,
        grain_cycle_mins, grain_prep_cool_mins,
        bulk_cycle_mins, bulk_prep_cool_mins,
        microlab_cycle_mins, microlab_prep_cool_mins,
        daily_available_mins, scheduling_horizon_days
      ) VALUES (
        @maxPcRunsPerDay, @maxBagsPerPcRun,
        @grainCycleMins, @grainPrepCoolMins,
        @bulkCycleMins, @bulkPrepCoolMins,
        @microlabCycleMins, @microlabPrepCoolMins,
        @dailyAvailableMins, @schedulingHorizonDays
      )
    `);

    db.transaction(() => {
      insertHw.run(s.hardware);

      const insertSpecies = db.prepare(`
        INSERT INTO species (common_name, substrate_type, bulk_prep_method)
        VALUES (@commonName, @substrateType, @bulkPrepMethod)
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
          max_generations, spore_clone_freq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const sp of s.species) {
        const result = insertSpecies.run({
          commonName: sp.commonName,
          substrateType: sp.substrateType || 'HWFP',
          bulkPrepMethod: sp.bulkPrepMethod || 'PC'
        });
        const speciesId = result.lastInsertRowid;
        
        insertProfile.run(
          speciesId,
          sp.lcToGen1DaysMin ?? 14, sp.lcToGen1DaysMax ?? 21,
          sp.gen2ColonizationDaysMin ?? 14, sp.gen2ColonizationDaysMax ?? 21,
          sp.bulkColonizationDaysMin ?? 14, sp.bulkColonizationDaysMax ?? 21,
          sp.fruitingDaysMin ?? 7, sp.fruitingDaysMax ?? 14,
          sp.gen1ToGen2Ratio ?? 10, sp.gen2ToBulkSpawnPct ?? 0.2,
          sp.targetBiologicalEfficiency ?? 0.5, sp.senescenceThresholdPct ?? 0.2,
          sp.maxGenerations ?? 8, sp.sporeCloneFreq ?? 3
        );
      }
    })();

    res.json({ success: true, message: 'Setup complete.' });
  } catch (err) {
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
        max_pc_runs_per_day    = COALESCE(@maxPcRunsPerDay, max_pc_runs_per_day),
        max_bags_per_pc_run    = COALESCE(@maxBagsPerPcRun, max_bags_per_pc_run),
        grain_cycle_mins       = COALESCE(@grainCycleMins, grain_cycle_mins),
        grain_prep_cool_mins   = COALESCE(@grainPrepCoolMins, grain_prep_cool_mins),
        bulk_cycle_mins        = COALESCE(@bulkCycleMins, bulk_cycle_mins),
        bulk_prep_cool_mins    = COALESCE(@bulkPrepCoolMins, bulk_prep_cool_mins),
        microlab_cycle_mins    = COALESCE(@microlabCycleMins, microlab_cycle_mins),
        microlab_prep_cool_mins= COALESCE(@microlabPrepCoolMins, microlab_prep_cool_mins),
        daily_available_mins   = COALESCE(@dailyAvailableMins, daily_available_mins),
        updated_at             = datetime('now')
      WHERE is_active = 1
    `).run(s);

    res.json({ success: true, message: 'Hardware settings updated. Re-run scheduler to apply.' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── PUT /api/settings/weekly-targets ─────────────────────────
router.put('/weekly-targets', (req: Request, res: Response) => {
  const db = getDb();
  const { targets } = req.body as { targets: Array<{ speciesId: number; targetBlocksPerWk: number }> };

  try {
    const upsert = db.prepare(`
      INSERT INTO weekly_targets (species_id, target_blocks_per_wk, is_active)
      VALUES (@speciesId, @targetBlocksPerWk, 1)
      ON CONFLICT(species_id) DO UPDATE SET
        target_blocks_per_wk = excluded.target_blocks_per_wk,
        is_active = 1
    `);

    const upsertMany = db.transaction(() => {
      for (const t of targets) upsert.run(t);
    });
    upsertMany();

    res.json({ success: true, message: 'Weekly targets updated. Re-run scheduler to apply.' });
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
    // Expire current profile
    db.prepare(`UPDATE species_profile SET effective_to = date('now') WHERE species_id = ? AND effective_to IS NULL`).run(id);

    // Insert new version
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

    res.json({ success: true, message: 'Species profile updated (version history preserved).' });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
