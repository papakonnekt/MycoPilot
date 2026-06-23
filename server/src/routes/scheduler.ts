import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { SchedulerEngine } from '../scheduler/SchedulerEngine';
import {
  HardwareSettings,
  Species,
  SpeciesProfile,
  FridgeSummaryRow,
  FridgeThreshold,
  WeeklyTarget,
  Batch,
  RawMaterial,
  MaterialUsageRecipe,
} from '../../../shared/types';
import { addDays, formatISO } from 'date-fns';

const router = Router();

// ── POST /api/scheduler/run ───────────────────────────────────
// Manually trigger a scheduler run (re-generates all PENDING tasks in horizon)
router.post('/run', async (req: Request, res: Response) => {
  const db = getDb();

  try {
    const today = new Date();

    // Load all inputs from DB
    const hw = db.prepare(`SELECT * FROM hardware_settings WHERE is_active = 1 LIMIT 1`)
      .get() as any;
    if (!hw) return res.status(400).json({ success: false, error: 'No active hardware settings found.' });

    const hardware: HardwareSettings = {
      id: hw.id,
      profileName: hw.profile_name,
      maxPcRunsPerDay: hw.max_pc_runs_per_day,
      maxBagsPerPcRun: hw.max_bags_per_pc_run,
      grainCycleMins: hw.grain_cycle_mins,
      grainPrepCoolMins: hw.grain_prep_cool_mins,
      bulkCycleMins: hw.bulk_cycle_mins,
      bulkPrepCoolMins: hw.bulk_prep_cool_mins,
      microlabCycleMins: hw.microlab_cycle_mins,
      microlabPrepCoolMins: hw.microlab_prep_cool_mins,
      homogeneousByBagType: Boolean(hw.homogeneous_by_bag_type),
      dailyAvailableMins: hw.daily_available_mins,
      schedulingHorizonDays: hw.scheduling_horizon_days,
      pcUnitCount: hw.pc_unit_count ?? 1,
      isActive: Boolean(hw.is_active),
      updatedAt: hw.updated_at,
    };

    // IDEMPOTENCY FIX: Wipe auto-generated PENDING/OVER_BUDGET tasks before regenerating
    const horizonEndDel = new Date(today);
    horizonEndDel.setDate(horizonEndDel.getDate() + hardware.schedulingHorizonDays);
    const deleteTasksResult = db.prepare(`
      DELETE FROM task 
      WHERE is_auto_generated = 1 
        AND status IN ('PENDING', 'OVER_BUDGET_WARNING')
        AND task_date BETWEEN ? AND ?
    `).run(today.toISOString().split('T')[0], horizonEndDel.toISOString().split('T')[0]);

    // Species
    const speciesRows = db.prepare(`SELECT * FROM species WHERE is_active = 1`).all() as any[];
    const speciesMap = new Map<number, Species>();
    for (const row of speciesRows) {
      speciesMap.set(row.id, {
        id: row.id,
        commonName: row.common_name,
        scientificName: row.scientific_name,
        substrateType: row.substrate_type,
        bulkPrepMethod: row.bulk_prep_method,
        lcVolumeMlAvailable: row.lc_volume_ml_available,
        lcInjectionVolumeMl: row.lc_injection_volume_ml,
        lcRestockThresholdMl: row.lc_restock_threshold_ml,
        notes: row.notes,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
      });
    }

    // Profiles (latest effective version per species)
    const profileRows = db.prepare(`
      SELECT * FROM species_profile WHERE effective_to IS NULL
    `).all() as any[];
    const profileMap = new Map<number, SpeciesProfile>();
    for (const row of profileRows) {
      profileMap.set(row.species_id, {
        id: row.id,
        speciesId: row.species_id,
        lcToGen1DaysMin: row.lc_to_gen1_days_min,
        lcToGen1DaysMax: row.lc_to_gen1_days_max,
        gen2ColonizationDaysMin: row.gen2_colonization_days_min,
        gen2ColonizationDaysMax: row.gen2_colonization_days_max,
        bulkColonizationDaysMin: row.bulk_colonization_days_min,
        bulkColonizationDaysMax: row.bulk_colonization_days_max,
        fruitingDaysMin: row.fruiting_days_min,
        fruitingDaysMax: row.fruiting_days_max,
        gen1ToGen2Ratio: row.gen1_to_gen2_ratio,
        gen2ToBulkSpawnPct: row.gen2_to_bulk_spawn_pct,
        targetBiologicalEfficiency: row.target_biological_efficiency,
        senescenceThresholdPct: row.senescence_threshold_pct,
        maxGenerations: row.max_generations,
        sporeCloneFreq: row.spore_clone_freq,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
      });
    }

    // Fridge summary
    const fridgeRows = db.prepare(`SELECT * FROM fridge_summary`).all() as any[];
    const fridgeSummary = new Map<number, FridgeSummaryRow>();
    for (const row of fridgeRows) {
      fridgeSummary.set(row.species_id, {
        speciesId: row.species_id,
        commonName: row.common_name,
        netAvailable: row.net_available ?? 0,
        batchCount: row.batch_count ?? 0,
        earliestExpiry: row.earliest_expiry,
        minGen2Bags: row.min_gen2_bags ?? 2,
        targetGen2Bags: row.target_gen2_bags ?? 5,
        belowThreshold: Boolean(row.below_threshold),
      });
    }

    // Fridge thresholds
    const threshRows = db.prepare(`SELECT * FROM fridge_thresholds`).all() as any[];
    const fridgeThresh = new Map<number, FridgeThreshold>();
    for (const row of threshRows) {
      fridgeThresh.set(row.species_id, {
        id: row.id,
        speciesId: row.species_id,
        minGen2Bags: row.min_gen2_bags,
        targetGen2Bags: row.target_gen2_bags,
        updatedAt: row.updated_at,
      });
    }

    // Weekly targets
    const weeklyTargets = db.prepare(`
      SELECT * FROM weekly_targets WHERE is_active = 1
    `).all() as WeeklyTarget[];

    // Active batches (non-terminal)
    const activeBatches = db.prepare(`
      SELECT b.*, s.common_name AS species_name
      FROM batch b
      JOIN species s ON s.id = b.species_id
      WHERE b.status NOT IN ('HARVESTED','SPENT','CONTAMINATED','DISPOSED','EXPIRED')
    `).all() as Batch[];

    // Raw materials
    const materialRows = db.prepare(`SELECT * FROM raw_material`).all() as any[];
    const rawMaterials = new Map<number, RawMaterial>();
    for (const row of materialRows) {
      rawMaterials.set(row.id, {
        id: row.id,
        materialName: row.material_name,
        unit: row.unit,
        quantityOnHand: row.quantity_on_hand,
        reorderThreshold: row.reorder_threshold,
        reorderQuantity: row.reorder_quantity,
        costPerUnit: row.cost_per_unit,
        supplierName: row.supplier_name,
        notes: row.notes,
        updatedAt: row.updated_at,
        isLow: row.quantity_on_hand <= row.reorder_threshold,
      });
    }

    // Usage recipes
    const usageRecipes = db.prepare(`SELECT * FROM material_usage_recipe`).all() as MaterialUsageRecipe[];

    // Existing pending tasks in horizon
    const horizonEnd = new Date(today);
    horizonEnd.setDate(horizonEnd.getDate() + hardware.schedulingHorizonDays);
    const existingTasks = db.prepare(`
      SELECT * FROM task
      WHERE task_date BETWEEN ? AND ?
        AND status IN ('PENDING', 'OVER_BUDGET_WARNING', 'FLAGGED')
    `).all(
      today.toISOString().split('T')[0],
      horizonEnd.toISOString().split('T')[0]
    ) as any[];

    // ── RUN ENGINE ────────────────────────────────────────────
    const engine = new SchedulerEngine();
    const output = engine.run({
      today,
      hardware,
      weeklyTargets: weeklyTargets.map(r => ({
        id: (r as any).id,
        speciesId: (r as any).species_id,
        targetBlocksPerWk: (r as any).target_blocks_per_wk,
        targetWeightGrams: (r as any).target_weight_grams,
        weekStartDate: (r as any).week_start_date,
        isActive: Boolean((r as any).is_active),
        createdAt: (r as any).created_at,
      })),
      speciesMap,
      profileMap,
      fridgeSummary,
      fridgeThresh,
      activeBatches,
      rawMaterials,
      usageRecipes,
      existingTasks,
    });

    // ── PERSIST RESULTS ───────────────────────────────────────
    const insertTask = db.prepare(`
      INSERT INTO task (
        task_date, task_type, title, description,
        species_id, batch_id, pc_run_id, lineage_id,
        estimated_mins, status, flush_number,
        depends_on_task_id, depends_on_batch_id,
        is_auto_generated, created_by, notes
      ) VALUES (
        @taskDate, @taskType, @title, @description,
        @speciesId, @batchId, @pcRunId, @lineageId,
        @estimatedMins, @status, @flushNumber,
        @dependsOnTaskId, @dependsOnBatchId,
        1, 'SCHEDULER', @notes
      )
    `);

    let tasksCreated = 0;
    const insertMany = db.transaction((tasks: any[]) => {
      for (const t of tasks) {
        insertTask.run({
          taskDate: t.taskDate,
          taskType: t.taskType,
          title: t.title,
          description: t.description ?? null,
          speciesId: t.speciesId ?? null,
          batchId: t.batchId ?? null,
          pcRunId: t.pcRunId ?? null,
          lineageId: t.lineageId ?? null,
          estimatedMins: t.estimatedMins ?? null,
          status: t.status ?? 'PENDING',
          flushNumber: t.flushNumber ?? null,
          dependsOnTaskId: t.dependsOnTaskId ?? null,
          dependsOnBatchId: t.dependsOnBatchId ?? null,
          notes: t.notes ?? null,
        });
        tasksCreated++;
      }
    });

    insertMany(output.tasks.filter(t => t.taskType && t.taskDate));

    // Log the run
    db.prepare(`
      INSERT INTO schedule_run_log (horizon_start, horizon_end, tasks_generated, tasks_deleted, warnings_json, triggered_by)
      VALUES (?, ?, ?, 0, ?, 'USER')
    `).run(
      today.toISOString().split('T')[0],
      horizonEnd.toISOString().split('T')[0],
      tasksCreated,
      JSON.stringify(output.warnings)
    );

    res.json({
      success: true,
      data: {
        tasksGenerated: tasksCreated,
        warnings: output.warnings,
        warningCount: output.warnings.length,
        horizon: `${today.toISOString().split('T')[0]} → ${horizonEnd.toISOString().split('T')[0]}`,
      },
    });
  } catch (err) {
    console.error('[SCHEDULER] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/scheduler/warnings ──────────────────────────────
router.get('/warnings', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const latest = db.prepare(`
      SELECT warnings_json, run_at FROM schedule_run_log ORDER BY run_at DESC LIMIT 1
    `).get() as { warnings_json: string; run_at: string } | undefined;

    res.json({
      success: true,
      data: {
        warnings: latest ? JSON.parse(latest.warnings_json ?? '[]') : [],
        asOf: latest?.run_at,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /api/scheduler/capacity ───────────────────────────────
// Get PC usage and task minutes over the scheduling horizon
router.get('/capacity', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const hw = db.prepare(`SELECT * FROM hardware_settings WHERE is_active = 1 LIMIT 1`).get() as any;
    if (!hw) {
      return res.json({ success: true, data: [] });
    }
    const maxPcRunsPerDay = hw.max_pc_runs_per_day;
    const dailyAvailableMins = hw.daily_available_mins;
    
    // PC Runs
    const pcRuns = db.prepare(`
      SELECT scheduled_date, COUNT(*) as run_count
      FROM pc_run
      WHERE scheduled_date >= date('now')
      GROUP BY scheduled_date
    `).all() as any[];

    // Tasks (minutes)
    const tasks = db.prepare(`
      SELECT task_date, SUM(estimated_mins) as total_mins
      FROM task
      WHERE task_date >= date('now')
      GROUP BY task_date
    `).all() as any[];

    const pcMap = new Map(pcRuns.map(r => [r.scheduled_date, r.run_count]));
    const taskMap = new Map(tasks.map(t => [t.task_date, t.total_mins]));

    const horizon = hw.scheduling_horizon_days || 28;
    const todayDate = new Date();
    
    const data = [];
    for (let i = 0; i < horizon; i++) {
      const d = addDays(todayDate, i);
      const dateStr = formatISO(d, { representation: 'date' });
      data.push({
        date: dateStr,
        pc_runs: pcMap.get(dateStr) || 0,
        max_pc_runs: maxPcRunsPerDay,
        task_mins: taskMap.get(dateStr) || 0,
        max_task_mins: dailyAvailableMins,
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Failed to get scheduler capacity:', error);
    res.status(500).json({ success: false, error: 'Failed to get scheduler capacity' });
  }
});

export default router;
