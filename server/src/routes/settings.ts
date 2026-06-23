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

      const insertTargets = db.prepare(`
        INSERT INTO weekly_targets (species_id, target_blocks) VALUES (?, ?)
      `);

      const insertFridge = db.prepare(`
        INSERT INTO fridge_thresholds (species_id, min_gen2_bags, target_gen2_bags) VALUES (?, ?, ?)
      `);

      const insertLineage = db.prepare(`
        INSERT INTO lineage (species_id, lineage_code, origin_type, generation_number)
        VALUES (?, ?, 'SPORE/CULTURE', 0)
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
        // 1. Insert Species
        const result = insertSpecies.run({
          commonName: sp.commonName,
          substrateType: sp.substrateType || 'HWFP',
          bulkPrepMethod: sp.bulkPrepMethod || 'PC'
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
          sp.maxGenerations ?? 3, sp.sporeCloneFreq ?? 3
        );

        // 3. Targets & Fridge
        if (sp.weeklyTargetBlocks) insertTargets.run(speciesId, sp.weeklyTargetBlocks);
        if (sp.fridgeTargetBags && sp.fridgeMinBags) insertFridge.run(speciesId, sp.fridgeMinBags, sp.fridgeTargetBags);

        // 4. Lineage Auto-Generation (e.g. "Blue Oyster" -> "BO-01")
        const initials = sp.commonName.split(' ').map((w: string) => w[0]).join('').toUpperCase();
        const lineageCode = \`\${initials}-01\`;
        const lineageResult = insertLineage.run(speciesId, lineageCode);
        const lineageId = lineageResult.lastInsertRowid;

        // 5. Raw Materials (Inventory)
        if (sp.startingLcVolumeMl > 0) {
          insertRawMaterial.run(\`Liquid Culture (\${lineageCode})\`, 'mL', sp.startingLcVolumeMl, \`Starting LC volume from onboarding\`);
        }
        
        if (sp.sterilizedGrains) {
          let totalLbs = 0;
          let notesArr = [];
          for (const item of sp.sterilizedGrains) {
            totalLbs += item.weightLbs * item.quantity;
            notesArr.push(\`\${item.quantity}x \${item.weightLbs}lb bags\`);
          }
          if (totalLbs > 0) {
            insertRawMaterial.run(\`Sterilized Grain (\${sp.commonName})\`, 'lbs', totalLbs, \`Ready-to-inoculate bags: \${notesArr.join(', ')}\`);
          }
        }

        if (sp.sterilizedSubstrate) {
          let totalLbs = 0;
          let notesArr = [];
          for (const item of sp.sterilizedSubstrate) {
            totalLbs += item.weightLbs * item.quantity;
            notesArr.push(\`\${item.quantity}x \${item.weightLbs}lb bags\`);
          }
          if (totalLbs > 0) {
            insertRawMaterial.run(\`Sterilized Substrate (\${sp.commonName})\`, 'lbs', totalLbs, \`Ready-to-inoculate bags: \${notesArr.join(', ')}\`);
          }
        }

        // 6. Incubating Spawn
        if (sp.incubating && sp.incubating.length > 0) {
          for (const item of sp.incubating) {
            const bId = `BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            
            let totalDays = 14;
            if (item.stage === 'GEN1_GRAIN') totalDays = sp.lcToGen1DaysMax ?? 21;
            else if (item.stage === 'GEN2_GRAIN') totalDays = sp.gen2ColonizationDaysMax ?? 21;
            else if (item.stage === 'BULK_BLOCK') totalDays = sp.bulkColonizationDaysMax ?? 21;
            
            const pct = item.colonizationPct || 0;
            const daysAgo = (pct / 100) * totalDays;
            const targetDaysFromNow = totalDays - daysAgo;

            const startStr = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
            const targetStr = new Date(Date.now() + targetDaysFromNow * 24 * 60 * 60 * 1000).toISOString();

            insertBatch.run(bId, speciesId, lineageId, item.stage, item.quantity, startStr, targetStr);
          }
        }
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
