import {
  AdjustedDemand,
  BatchStage,
  BatchStatus,
  BagType,
  DayEntry,
  DemandResult,
  FridgeSummaryRow,
  FridgeThreshold,
  HardwareSettings,
  PCRunDraft,
  PCRunType,
  SchedulerOutput,
  SchedulerWarning,
  Species,
  SpeciesProfile,
  Task,
  TaskType,
  WeeklyTarget,
  Batch,
  RawMaterial,
  MaterialUsageRecipe,
} from '../../../shared/types';

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
}

function fromDateStr(s: string): Date {
  return new Date(s + 'T00:00:00');
}

/**
 * Generate a batch ID in the format: SPECIES_CODE-TYPE_CODE-MMDD-SEQ
 * e.g., "JF-PC-0618-001"
 */
export function generateBatchId(
  speciesCode: string,
  typeCode: string,
  date: Date,
  seq: number
): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seqStr = String(seq).padStart(3, '0');
  return `${speciesCode}-${typeCode}-${mm}${dd}-${seqStr}`;
}

/** Estimate task time in minutes */
function estimateMins(taskType: TaskType, hw: HardwareSettings, quantity = 1): number {
  switch (taskType) {
    case 'PC_RUN_GRAIN':    return hw.grainCycleMins + hw.grainPrepCoolMins;
    case 'PC_RUN_BULK':     return hw.bulkCycleMins + hw.bulkPrepCoolMins;
    case 'PC_RUN_MICROLAB': return hw.microlabCycleMins + hw.microlabPrepCoolMins;
    case 'INOCULATE_GEN1':  return Math.min(30 * quantity, 90);
    case 'G2G_TRANSFER':    return 60;
    case 'INOCULATE_BULK':  return 45;
    case 'PASTEURIZE_BULK_CVG': return 60;
    case 'LOAD_FRUITING_CHAMBER': return 30;
    case 'START_FRUITING':  return 30;
    case 'HARVEST':         return 20 * quantity;
    case 'MARK_SPENT_TOSS': return 5;
    case 'MOVE_TO_FRIDGE':  return 10;
    case 'PREP_LC':         return 45;
    case 'PREP_AGAR':       return 60;
    case 'INOCULATE_LC':    return 30;
    case 'COLLECT_SPORE_PRINT': return 30;
    case 'CLONE_BEST_CLUSTER':  return 45;
    case 'START_NEW_LC_FROM_SPORE': return 30;
    case 'FLAG_SENESCENCE': return 5;
    case 'REORDER_MATERIAL': return 5;
    case 'REVIEW_BATCH':    return 10;
    default:                return 15;
  }
}

// ─────────────────────────────────────────────────────────────
// SCHEDULER ENGINE
// ─────────────────────────────────────────────────────────────

export class SchedulerEngine {
  private seqCounters: Map<string, number> = new Map();

  private nextSeq(key: string): number {
    const n = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, n);
    return n;
  }

  // ── PUBLIC ENTRY POINT ────────────────────────────────────

  run(params: {
    today: Date;
    hardware: HardwareSettings;
    weeklyTargets: WeeklyTarget[];
    speciesMap: Map<number, Species>;
    profileMap: Map<number, SpeciesProfile>;
    fridgeSummary: Map<number, FridgeSummaryRow>;
    fridgeThresh: Map<number, FridgeThreshold>;
    activeBatches: Batch[];
    rawMaterials: Map<number, RawMaterial>;
    usageRecipes: MaterialUsageRecipe[];
    existingTasks: Task[];
  }): SchedulerOutput {
    const output: SchedulerOutput = {
      tasks: [],
      warnings: [],
      inventoryDeltas: [],
      lcDeltas: {},
      pcRunDrafts: [],
    };

    // Reset per-run sequence counters
    this.seqCounters.clear();

    // Build mutable 28-day calendar
    const calendar = this.buildCalendar(params.today, params.hardware, params.existingTasks);

    // ── STEP 1: Demand calculation ────────────────────────────
    const demands = params.weeklyTargets
      .filter(t => t.isActive)
      .map(target => {
        const profile = params.profileMap.get(target.speciesId);
        const species = params.speciesMap.get(target.speciesId);
        if (!profile || !species) return null;
        return this.computeDemand(target, species, profile);
      })
      .filter((d): d is DemandResult => d !== null);

    // ── STEP 2: Apply fridge reduction ───────────────────────
    const adjustedDemands = demands.map(d =>
      this.applyFridgeReduction(d, params.fridgeSummary, params.fridgeThresh)
    );

    // ── STEP 3: Generate production chain tasks ───────────────
    for (const demand of adjustedDemands) {
      const species = params.speciesMap.get(demand.speciesId)!;
      const speciesCode = this.getSpeciesCode(species.commonName);
      this.generateProductionChain(demand, species, speciesCode, params.today, calendar, params.hardware, output);
    }

    // ── STEP 4: Pack PC runs across calendar ─────────────────
    this.packPCRuns(calendar, params.hardware, output);

    // ── STEP 5: Tick active batches (colonization timers) ─────
    this.tickActiveBatches(params.activeBatches, params.today, calendar, params.hardware, output);

    // ── STEP 6: LC depletion checks ──────────────────────────
    this.reconcileLC(output.tasks, params.speciesMap, output);

    // ── STEP 7: Raw material depletion ────────────────────────
    this.reconcileInventory(output.tasks, params.rawMaterials, params.usageRecipes, output);

    // ── STEP 8: Scan for constraint violations ────────────────
    this.detectViolations(calendar, params.hardware, output);

    // ── STEP 9: Flatten calendar to ordered task list ─────────
    output.tasks = this.flattenCalendar(calendar);

    return output;
  }

  // ── STEP 1: DEMAND CALCULATOR ─────────────────────────────

  private computeDemand(
    target: WeeklyTarget,
    species: Species,
    profile: SpeciesProfile
  ): DemandResult {
    const T = target.targetBlocksPerWk;

    // 1 Gen2 bag → 1 bulk block (the spawn pct affects weight ratio, not bag count)
    const bulkBlocksNeeded  = T;
    const gen2BagsNeeded    = T;
    const gen1BagsNeeded    = Math.ceil(gen2BagsNeeded / profile.gen1ToGen2Ratio);

    // Grain PC demand: Gen1 bags + Gen2 bags (Q1: grouped by bag-type, not species)
    const totalGrainBagsPerWeek = gen1BagsNeeded + gen2BagsNeeded;

    // Bulk PC demand: only HWFP species use PC for bulk (CVG=pasteurize, GRAIN=none)
    const totalBulkBagsPerWeek =
      species.bulkPrepMethod === 'PC' ? bulkBlocksNeeded : 0;

    // LC consumption
    const lcMlPerWeek = gen1BagsNeeded * species.lcInjectionVolumeMl;

    return {
      speciesId: target.speciesId,
      speciesName: species.commonName,
      weeklyBlocks: T,
      bulkBlocksNeeded,
      gen2BagsNeeded,
      gen1BagsNeeded,
      totalGrainBagsPerWeek,
      totalBulkBagsPerWeek,
      lcMlPerWeek,
      profile,
    };
  }

  // ── STEP 2: FRIDGE REDUCTION ──────────────────────────────

  private applyFridgeReduction(
    demand: DemandResult,
    fridgeSummary: Map<number, FridgeSummaryRow>,
    fridgeThresh: Map<number, FridgeThreshold>
  ): AdjustedDemand {
    const fridgeRow = fridgeSummary.get(demand.speciesId);
    const threshold = fridgeThresh.get(demand.speciesId);

    const available  = fridgeRow?.netAvailable ?? 0;
    const minThresh  = threshold?.minGen2Bags ?? 2;
    const restockTo  = threshold?.targetGen2Bags ?? 5;

    const weeklyNeed     = demand.gen2BagsNeeded;
    const pullFromFridge = Math.min(available, weeklyNeed);
    const produceNew     = weeklyNeed - pullFromFridge;

    // After pulling, will fridge be below minimum?
    const postPullLevel = available - pullFromFridge;
    const needsRestock  = postPullLevel < minThresh;
    const restockQty    = needsRestock ? Math.max(0, restockTo - postPullLevel) : 0;

    // New Gen1 bags needed for new production + fridge restock
    const gen1BagsAdjusted = Math.ceil(
      (produceNew + restockQty) / demand.profile.gen1ToGen2Ratio
    );

    return {
      ...demand,
      gen2BagsFromFridge: pullFromFridge,
      gen2BagsNewProduction: produceNew,
      gen2BagsToRestock: restockQty,
      gen1BagsAdjusted,
    };
  }

  // ── STEP 3: PRODUCTION CHAIN GENERATOR ───────────────────

  private generateProductionChain(
    demand: AdjustedDemand,
    species: Species,
    speciesCode: string,
    today: Date,
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    const p = demand.profile;

    // Working backward from a target harvest at the end of the 28-day horizon:
    // We schedule tasks at the correct biological offset from today.
    //
    // The approach: figure out WHEN each stage needs to START,
    // counting backward from the expected harvest window.

    // Harvest target: end of horizon
    const harvestTarget = addDays(today, hw.schedulingHorizonDays);

    // ── HARVEST tasks ────────────────────────────────────────
    // For blocks currently fruiting (handled by tickActiveBatches)
    // New production chain for the horizon:

    // Bulk inoculation date: harvest minus fruiting period
    const bulkInocDate = addDays(harvestTarget, -(p.fruitingDaysMax + p.bulkColonizationDaysMax));

    // G2G transfer date: bulk inoculation minus gen2 colonization
    const g2gDate = addDays(bulkInocDate, -(p.gen2ColonizationDaysMax));

    // Gen1 inoculation date: G2G minus gen1 colonization
    const gen1InocDate = addDays(g2gDate, -(p.lcToGen1DaysMax));

    // PC_GRAIN runs: day before each inoculation step (bags need cooling)
    const pcGrainForGen1Date = addDays(gen1InocDate, -1);
    const pcGrainForGen2Date = addDays(g2gDate, -1); // Sterilize Gen2 grain before G2G

    // ── Only schedule if new production is needed ─────────────
    if (demand.gen2BagsNewProduction > 0 || demand.gen2BagsToRestock > 0) {

      // PC_RUN_GRAIN for Gen1 bags
      if (demand.gen1BagsAdjusted > 0 && this.isInHorizon(pcGrainForGen1Date, today, hw)) {
        this.addPCRequest(calendar, {
          runType: 'GRAIN',
          date: pcGrainForGen1Date,
          speciesId: demand.speciesId,
          speciesCode,
          bagType: 'GEN1_GRAIN',
          bagCount: demand.gen1BagsAdjusted,
          deadlineDate: gen1InocDate,
          batchId: generateBatchId(speciesCode, 'G1', pcGrainForGen1Date, this.nextSeq(`${speciesCode}-G1`)),
        });
      }

      // INOCULATE_GEN1 task
      if (this.isInHorizon(gen1InocDate, today, hw)) {
        this.addTask(calendar, gen1InocDate, {
          taskType: 'INOCULATE_GEN1',
          title: `Inoculate Gen1 Grain — ${demand.gen1BagsAdjusted}× ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('INOCULATE_GEN1', hw, demand.gen1BagsAdjusted),
          status: 'PENDING',
          notes: `Scheduled to meet weekly target (${demand.weeklyBlocks} blocks) + fridge restock (${demand.gen2BagsToRestock} bags). Requires ${demand.gen1BagsAdjusted} Gen1 bags.`,
        }, hw, output);
      }

      // PC_RUN_GRAIN for Gen2 bags (sterilize before G2G)
      const gen2BagsToMake = demand.gen2BagsNewProduction + demand.gen2BagsToRestock;
      if (gen2BagsToMake > 0 && this.isInHorizon(pcGrainForGen2Date, today, hw)) {
        this.addPCRequest(calendar, {
          runType: 'GRAIN',
          date: pcGrainForGen2Date,
          speciesId: demand.speciesId,
          speciesCode,
          bagType: 'GEN2_GRAIN',
          bagCount: gen2BagsToMake,
          deadlineDate: g2gDate,
          batchId: generateBatchId(speciesCode, 'G2', pcGrainForGen2Date, this.nextSeq(`${speciesCode}-G2`)),
        });
      }

      // G2G_TRANSFER task
      if (this.isInHorizon(g2gDate, today, hw)) {
        this.addTask(calendar, g2gDate, {
          taskType: 'G2G_TRANSFER',
          title: `G2G Transfer — ${demand.gen1BagsAdjusted}× Gen1 → ${gen2BagsToMake}× Gen2 ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('G2G_TRANSFER', hw),
          status: 'PENDING',
          notes: `Scheduled to produce ${gen2BagsToMake} Gen2 bags for bulk inoculation and fridge restocking.`,
        }, hw, output);
      }
    }

    // ── FRIDGE pull tasks ─────────────────────────────────────
    if (demand.gen2BagsFromFridge > 0 && this.isInHorizon(bulkInocDate, today, hw)) {
      this.addTask(calendar, bulkInocDate, {
        taskType: 'MOVE_TO_FRIDGE',
        title: `Pull ${demand.gen2BagsFromFridge}× ${demand.speciesName} Gen2 from Fridge`,
        speciesId: demand.speciesId,
        estimatedMins: estimateMins('MOVE_TO_FRIDGE', hw),
        status: 'PENDING',
        notes: `Pulling ${demand.gen2BagsFromFridge} Gen2 bags from fridge buffer to meet bulk inoculation target without new production.`,
      }, hw, output);
    }

    // ── BULK inoculation ──────────────────────────────────────
    if (demand.gen2BagsNewProduction > 0 && this.isInHorizon(bulkInocDate, today, hw)) {

      if (species.bulkPrepMethod === 'PC') {
        // PC_RUN_BULK day before inoculation
        const pcBulkDate = addDays(bulkInocDate, -1);
        if (this.isInHorizon(pcBulkDate, today, hw)) {
          this.addPCRequest(calendar, {
            runType: 'BULK',
            date: pcBulkDate,
            speciesId: demand.speciesId,
            speciesCode,
            bagType: 'BULK_HWFP',
            bagCount: demand.gen2BagsNewProduction,
            deadlineDate: bulkInocDate,
            batchId: generateBatchId(speciesCode, 'BLK', pcBulkDate, this.nextSeq(`${speciesCode}-BLK`)),
          });
        }

        this.addTask(calendar, bulkInocDate, {
          taskType: 'INOCULATE_BULK',
          title: `Inoculate Bulk HWFP — ${demand.gen2BagsNewProduction}× ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('INOCULATE_BULK', hw),
          status: 'PENDING',
          notes: `Scheduled to inoculate ${demand.bulkBlocksNeeded} bulk blocks to meet target harvest goal.`,
        }, hw, output);

      } else if (species.bulkPrepMethod === 'PASTEURIZE') {
        // Pasteurize CVG same day (no PC needed)
        this.addTask(calendar, bulkInocDate, {
          taskType: 'PASTEURIZE_BULK_CVG',
          title: `Pasteurize CVG + Inoculate — ${demand.gen2BagsNewProduction}× ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('PASTEURIZE_BULK_CVG', hw) + estimateMins('INOCULATE_BULK', hw),
          status: 'PENDING',
          notes: `Scheduled to prepare and inoculate ${demand.bulkBlocksNeeded} pasteurized blocks to meet target harvest goal.`,
        }, hw, output);

      } else if (species.bulkPrepMethod === 'NONE') {
        // Cordyceps: load fruiting chamber directly from grain bag
        this.addTask(calendar, bulkInocDate, {
          taskType: 'LOAD_FRUITING_CHAMBER',
          title: `Load Fruiting Chamber — ${demand.gen2BagsNewProduction}× ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('LOAD_FRUITING_CHAMBER', hw),
          status: 'PENDING',
          notes: `Scheduled to move ${demand.gen2BagsNewProduction} bags to fruiting chamber to meet target harvest goal.`,
        }, hw, output);
      }
    }

    // ── MOVE surplus Gen2 to Fridge ───────────────────────────
    // After G2G, if more Gen2 made than needed for bulk, remainder goes to fridge
    const surplusGen2 = demand.gen2BagsToRestock;
    if (surplusGen2 > 0 && this.isInHorizon(g2gDate, today, hw)) {
      const moveFridgeDate = addDays(g2gDate, p.gen2ColonizationDaysMax);
      if (this.isInHorizon(moveFridgeDate, today, hw)) {
        this.addTask(calendar, moveFridgeDate, {
          taskType: 'MOVE_TO_FRIDGE',
          title: `Move ${surplusGen2}× ${demand.speciesName} Gen2 → Fridge Buffer`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('MOVE_TO_FRIDGE', hw),
          status: 'PENDING',
          notes: `Moving surplus Gen2 bags (${surplusGen2} bags) produced during G2G transfer to fridge buffer.`,
        }, hw, output);
      }
    }
  }

  // ── STEP 4: PC RUN BIN-PACKING ────────────────────────────

  /**
   * Intermediate store for PC requests before bin-packing.
   * Added via addPCRequest() during generateProductionChain().
   */
  private pcRequests: Array<{
    runType: PCRunType;
    date: Date;
    speciesId: number;
    speciesCode: string;
    bagType: BagType;
    bagCount: number;
    deadlineDate: Date;
    batchId: string;
  }> = [];

  private addPCRequest(
    calendar: Map<string, DayEntry>,
    req: {
      runType: PCRunType;
      date: Date;
      speciesId: number;
      speciesCode: string;
      bagType: BagType;
      bagCount: number;
      deadlineDate: Date;
      batchId: string;
    }
  ): void {
    this.pcRequests.push(req);
  }

  private packPCRuns(
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    // Sort by deadline urgency (earliest deadline first)
    const requests = [...this.pcRequests].sort(
      (a, b) => a.deadlineDate.getTime() - b.deadlineDate.getTime()
    );

    for (const req of requests) {
      let remainingBags = req.bagCount;
      let placed = false;

      // Try to place on preferred date first, then scan forward to deadline
      const startDate = new Date(req.date);
      const endDate = new Date(req.deadlineDate);

      for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
        if (remainingBags <= 0) { placed = true; break; }

        const dayKey = toDateStr(d);
        const day = calendar.get(dayKey);
        if (!day) continue;

        const grainRuns = day.pcRuns.filter(r => r.runType === 'GRAIN').length;
        const bulkRuns  = day.pcRuns.filter(r => r.runType === 'BULK').length;
        const mlabRuns  = day.pcRuns.filter(r => r.runType === 'MICROLAB').length;
        const totalRuns = grainRuns + bulkRuns + mlabRuns;

        // Hard constraint: no more than maxPcRunsPerDay
        if (totalRuns >= hw.maxPcRunsPerDay) continue;

        // Hard constraint: MICROLAB never shares a day with GRAIN or BULK
        if (req.runType === 'MICROLAB' && (grainRuns + bulkRuns > 0)) continue;
        if (req.runType !== 'MICROLAB' && mlabRuns > 0) continue;

        // Try to fill an existing same-type run first
        const existingRun = day.pcRuns.find(r => r.runType === req.runType);
        if (existingRun) {
          const usedSlots = existingRun.slots.reduce((s, sl) => s + sl.quantity, 0);
          const openSlots = hw.maxBagsPerPcRun - usedSlots;
          if (openSlots > 0) {
            const toPlace = Math.min(remainingBags, openSlots);
            existingRun.slots.push({ speciesId: req.speciesId, bagType: req.bagType, quantity: toPlace });
            existingRun.bagCount += toPlace;
            remainingBags -= toPlace;
            if (remainingBags === 0) { placed = true; break; }
          }
        } else {
          // Open a new run on this day
          const toPlace = Math.min(remainingBags, hw.maxBagsPerPcRun);
          const cycleMins = req.runType === 'MICROLAB'
            ? hw.microlabCycleMins + hw.microlabPrepCoolMins
            : req.runType === 'GRAIN'
              ? hw.grainCycleMins + hw.grainPrepCoolMins
              : hw.bulkCycleMins + hw.bulkPrepCoolMins;

          const newRun: PCRunDraft = {
            runType: req.runType,
            date: dayKey,
            bagCount: toPlace,
            cycleMins,
            slots: [{ speciesId: req.speciesId, bagType: req.bagType, quantity: toPlace }],
          };
          day.pcRuns.push(newRun);
          output.pcRunDrafts.push(newRun);

          // Add as a task for the day
          const taskType: TaskType = req.runType === 'GRAIN'
            ? 'PC_RUN_GRAIN'
            : req.runType === 'BULK'
              ? 'PC_RUN_BULK'
              : 'PC_RUN_MICROLAB';

          this.addTask(calendar, d, {
            taskType,
            title: `PC Run [${req.runType}] — ${toPlace} bags (${req.speciesCode})`,
            speciesId: req.speciesId,
            estimatedMins: cycleMins,
            status: 'PENDING',
          }, hw, output);

          remainingBags -= toPlace;
          if (remainingBags === 0) { placed = true; break; }
        }
      }

      if (!placed || remainingBags > 0) {
        output.warnings.push({
          type: 'IMPOSSIBLE_DEADLINE',
          date: toDateStr(req.deadlineDate),
          message:
            `Cannot schedule all PC_RUN_${req.runType} bags for ${req.speciesCode} ` +
            `before deadline ${toDateStr(req.deadlineDate)}. ` +
            `${remainingBags} bags unscheduled. ` +
            `Consider increasing maxPcRunsPerDay (currently ${hw.maxPcRunsPerDay}).`,
          taskRef: req.batchId,
          severity: 'ERROR',
        });
      }
    }

    // Reset for next run call
    this.pcRequests = [];
  }

  // ── STEP 5: TICK ACTIVE BATCHES ──────────────────────────

  private tickActiveBatches(
    batches: Batch[],
    today: Date,
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    for (const batch of batches) {
      // Check colonization completion
      if (batch.status === 'INCUBATING' && batch.colonizationTarget) {
        const targetDate = fromDateStr(batch.colonizationTarget);
        if (today >= targetDate) {
          // Batch is past its colonization target — flag for review
          output.warnings.push({
            type: 'FRIDGE_LOW',
            date: toDateStr(today),
            message: `Batch ${batch.batchId} colonization target was ${batch.colonizationTarget}. ` +
                     `Please mark as COLONIZED or review.`,
            taskRef: batch.batchId,
            severity: 'WARNING',
          });
        }
      }

      // Check fridge expiry (Q2: 90-day limit)
      if (batch.status === 'IN_FRIDGE' && batch.colonizationTarget) {
        const expiryDate = addDays(fromDateStr(batch.colonizationTarget), 90);
        const daysToExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / 86400000);
        if (daysToExpiry <= 7 && daysToExpiry > 0) {
          output.warnings.push({
            type: 'FRIDGE_EXPIRY',
            date: toDateStr(expiryDate),
            message: `Fridge batch ${batch.batchId} (${batch.speciesName}) expires in ${daysToExpiry} days. ` +
                     `Use it or it will be marked EXPIRED.`,
            taskRef: batch.batchId,
            severity: 'WARNING',
          });
        }
      }

      // Auto-generate next flush task for fruiting batches (Q3)
      if (batch.status === 'FRUITING' && batch.fruitingTargetEnd) {
        const nextFlushDate = fromDateStr(batch.fruitingTargetEnd);
        if (this.isInHorizon(nextFlushDate, today, hw)) {
          const flushNum = (batch.flushCount ?? 0) + 1;
          this.addTask(calendar, nextFlushDate, {
            taskType: 'HARVEST',
            title: `Harvest Flush ${flushNum} — ${batch.batchId}`,
            speciesId: batch.speciesId,
            batchId: batch.id,
            flushNumber: flushNum,
            dependsOnBatchId: batch.id,
            estimatedMins: estimateMins('HARVEST', hw),
            status: 'PENDING',
          }, hw, output);
        }
      }
    }
  }

  // ── STEP 6: LC RECONCILIATION ────────────────────────────

  private reconcileLC(
    tasks: Partial<Task>[],
    speciesMap: Map<number, Species>,
    output: SchedulerOutput
  ): void {
    // Build per-species LC consumption from scheduled INOCULATE_GEN1 tasks
    const consumption: Map<number, number> = new Map();
    for (const task of tasks) {
      if (task.taskType === 'INOCULATE_GEN1' && task.speciesId != null) {
        const current = consumption.get(task.speciesId) ?? 0;
        const species = speciesMap.get(task.speciesId);
        if (species) {
          consumption.set(task.speciesId, current + species.lcInjectionVolumeMl);
        }
      }
    }

    // Check against available LC per species
    for (const [speciesId, totalMl] of consumption.entries()) {
      const species = speciesMap.get(speciesId);
      if (!species) continue;

      const available = species.lcVolumeMlAvailable;
      output.lcDeltas[speciesId] = -totalMl;

      if (totalMl > available) {
        output.warnings.push({
          type: 'LC_LOW',
          date: new Date().toISOString().split('T')[0],
          message: `${species.commonName} LC INSUFFICIENT: need ${totalMl}mL, ` +
                   `only ${available}mL available. Schedule PREP_LC immediately.`,
          taskRef: `${species.commonName}-LC`,
          severity: 'ERROR',
        });
      } else if ((available - totalMl) < species.lcRestockThresholdMl) {
        output.warnings.push({
          type: 'LC_LOW',
          date: new Date().toISOString().split('T')[0],
          message: `${species.commonName} LC will drop to ${(available - totalMl).toFixed(0)}mL ` +
                   `after scheduled tasks — below threshold of ${species.lcRestockThresholdMl}mL. ` +
                   `Schedule PREP_LC soon.`,
          taskRef: `${species.commonName}-LC`,
          severity: 'WARNING',
        });
      }
    }
  }

  // ── STEP 7: RAW MATERIAL RECONCILIATION ──────────────────

  private reconcileInventory(
    tasks: Partial<Task>[],
    rawMaterials: Map<number, RawMaterial>,
    recipes: MaterialUsageRecipe[],
    output: SchedulerOutput
  ): void {
    // Running totals per material
    const consumed: Map<number, number> = new Map();

    for (const task of tasks) {
      if (!task.taskType) continue;
      const taskRecipes = recipes.filter(r => r.taskType === task.taskType);
      for (const recipe of taskRecipes) {
        // Estimate bag count from task (default 1)
        const bagCount = 1;
        const total = recipe.quantityPerBag * bagCount;
        consumed.set(recipe.materialId, (consumed.get(recipe.materialId) ?? 0) + total);
      }
    }

    for (const [materialId, totalConsumed] of consumed.entries()) {
      const material = rawMaterials.get(materialId);
      if (!material) continue;

      const remaining = material.quantityOnHand - totalConsumed;
      output.inventoryDeltas.push({ materialId, delta: -totalConsumed });

      if (remaining < material.reorderThreshold) {
        output.warnings.push({
          type: 'MATERIAL_LOW',
          date: new Date().toISOString().split('T')[0],
          message: `${material.materialName} will drop to ${remaining.toFixed(1)} ${material.unit} ` +
                   `after scheduled tasks — below reorder threshold of ${material.reorderThreshold} ${material.unit}.`,
          taskRef: `REORDER-${material.materialName}`,
          severity: remaining <= 0 ? 'ERROR' : 'WARNING',
        });
      }
    }
  }

  // ── STEP 8: CONSTRAINT VIOLATION SCAN ────────────────────

  private detectViolations(
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    for (const [dateStr, day] of calendar.entries()) {
      // Check PC run ceiling
      if (day.pcRuns.length > hw.maxPcRunsPerDay) {
        output.warnings.push({
          type: 'PC_CAPACITY',
          date: dateStr,
          message: `Day ${dateStr} has ${day.pcRuns.length} PC runs scheduled but max is ${hw.maxPcRunsPerDay}.`,
          taskRef: 'PC_CAP',
          severity: 'ERROR',
        });
      }

      // Check for illegal MICROLAB + GRAIN/BULK mixing on same day
      const hasGrainBulk = day.pcRuns.some(r => r.runType === 'GRAIN' || r.runType === 'BULK');
      const hasMicrolab  = day.pcRuns.some(r => r.runType === 'MICROLAB');
      if (hasGrainBulk && hasMicrolab) {
        output.warnings.push({
          type: 'PC_CAPACITY',
          date: dateStr,
          message: `CONSTRAINT VIOLATION on ${dateStr}: MICROLAB run shares day with GRAIN/BULK run. ` +
                   `Must separate — MICROLAB contamination risk.`,
          taskRef: 'MICROLAB_MIX',
          severity: 'ERROR',
        });
      }

      // Flag over-budget days (Q4: soft warning, not block)
      const totalMins = day.tasks.reduce((s, t) => s + (t.estimatedMins ?? 0), 0);
      if (totalMins > hw.dailyAvailableMins) {
        day.isOverBudget = true;
        output.warnings.push({
          type: 'OVER_BUDGET',
          date: dateStr,
          message: `Day ${dateStr}: ${totalMins} min of tasks vs ${hw.dailyAvailableMins} min budget. ` +
                   `Flagged OVER_BUDGET_WARNING — tasks remain scheduled.`,
          taskRef: 'TIME_BUDGET',
          severity: 'WARNING',
        });
        // Mark all tasks on this day as over-budget
        for (const task of day.tasks) {
          if (task.status === 'PENDING') {
            task.status = 'OVER_BUDGET_WARNING';
          }
        }
      }
    }
  }

  // ── HELPERS ───────────────────────────────────────────────

  private buildCalendar(
    today: Date,
    hw: HardwareSettings,
    existingTasks: Task[]
  ): Map<string, DayEntry> {
    const calendar = new Map<string, DayEntry>();
    for (let i = 0; i < hw.schedulingHorizonDays; i++) {
      const d = addDays(today, i);
      const key = toDateStr(d);
      calendar.set(key, {
        date: key,
        tasks: [],
        pcRuns: [],
        totalMins: 0,
        isOverBudget: false,
      });
    }
    // Pre-populate with existing tasks
    for (const task of existingTasks) {
      const day = calendar.get(task.taskDate);
      if (day) day.tasks.push(task);
    }
    return calendar;
  }

  private addTask(
    calendar: Map<string, DayEntry>,
    date: Date,
    task: Partial<Task>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    const key = toDateStr(date);
    const day = calendar.get(key);
    if (!day) return; // Outside horizon
    day.tasks.push({ ...task, taskDate: key, isAutoGenerated: true });
  }

  private isInHorizon(date: Date, today: Date, hw: HardwareSettings): boolean {
    const horizon = addDays(today, hw.schedulingHorizonDays);
    return date >= today && date <= horizon;
  }

  private flattenCalendar(calendar: Map<string, DayEntry>): Partial<Task>[] {
    const tasks: Partial<Task>[] = [];
    for (const [, day] of [...calendar.entries()].sort()) {
      tasks.push(...day.tasks);
    }
    return tasks;
  }

  private getSpeciesCode(commonName: string): string {
    const codes: Record<string, string> = {
      'Jack Frost':   'JF',
      "Lion's Mane":  'LM',
      'Pink Oyster':  'PO',
      'Cordyceps':    'COR',
    };
    return codes[commonName] ?? commonName.substring(0, 3).toUpperCase();
  }
}
