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
  TargetInterval,
  Task,
  TaskType,
  WeeklyTarget,
  Batch,
  RawMaterial,
  MaterialUsageRecipe,
} from '../../../shared/types';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// PHASE 5 CONSTANTS & GUARDS
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Number of days between active chain generations per cadence.
 *   WEEKLY  -> every 7 days (legacy default)
 *   MONTHLY -> every 28 days = the "Monthly Rotator" slot.
 */
const INTERVAL_DAYS: Record<TargetInterval, number> = {
  WEEKLY:  7,
  MONTHLY: 28,
};

/** Normalize an arbitrary interval value to a known enum. Missing / unknown values fall back to WEEKLY. */
function normalizeInterval(raw: TargetInterval | undefined | null): TargetInterval {
  if (raw === 'MONTHLY') return 'MONTHLY';
  return 'WEEKLY';
}

/** Coerce an optional / NaN number to a finite default. Used to guard calculations when a column is missing. */
function safeNumber(n: number | undefined | null, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/**
 * Phase 5 Step 2: dynamic horizon.
 *
 * Compute the scheduling horizon (in days) from the slowest active species
 * biological timeline. Returns the MAX of:
 *   lcToGen1DaysMax + gen2ColonizationDaysMax + bulkColonizationDaysMax + fruitingDaysMax
 * across every active species that has a profile. Missing fields collapse to 0
 * via safeNumber. A FALLBACK is returned if there are no active species or all
 * timelines are zero, so the engine never sees horizon = 0.
 */
export const HORIZON_FALLBACK_DAYS = 28;

export function computeHorizonDays(
  speciesMap: Map<number, Species>,
  profileMap: Map<number, SpeciesProfile>,
  fallback: number = HORIZON_FALLBACK_DAYS
): number {
  let maxDays = 0;
  for (const [speciesId, species] of speciesMap.entries()) {
    // Defensive: route filters on is_active=1, but if the engine is ever called
    // from a context that passes inactive species we still skip them here.
    if (!species || species.isActive === false) continue;

    const profile = profileMap.get(speciesId);
    if (!profile) continue;

    const total =
      safeNumber(profile.lcToGen1DaysMax, 0) +
      safeNumber(profile.gen2ColonizationDaysMax, 0) +
      safeNumber(profile.bulkColonizationDaysMax, 0) +
      safeNumber(profile.fruitingDaysMax, 0);

    if (total > maxDays) maxDays = total;
  }
  // Never let horizon collapse to 0 - would make the calendar empty and the
  // horizon loop unsafe. Use the fallback.
  return maxDays > 0 ? maxDays : fallback;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function shiftIfClosed(date: Date, hw: HardwareSettings, direction: 1 | -1 = 1): Date {
  const d = new Date(date);
  const labDays = hw.labDays || [0, 1, 2, 3, 4, 5, 6];
  if (labDays.length === 0) return d; // Prevent infinite loop if all days are closed

  let iterations = 0;
  while (!labDays.includes(d.getDay()) && iterations < 7) {
    d.setDate(d.getDate() + direction);
    iterations++;
  }
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
    case 'SOAK_BLOCKS':     return 30;
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// SCHEDULER ENGINE
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export class SchedulerEngine {
  private seqCounters: Map<string, number> = new Map();

  private nextSeq(key: string): number {
    const n = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, n);
    return n;
  }

  // ------ PUBLIC ENTRY POINT ------------------------------------------------------------------------------------------------------------

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
      // Phase 5 Step 2: dynamic horizon, derived from slowest active species.
      // See computeHorizonDays() above for the math. Filled in below.
      horizonDays: HORIZON_FALLBACK_DAYS,
    };

    // Reset per-run sequence counters
    this.seqCounters.clear();

    // Phase 5 Step 2: derive horizon from slowest active species' biological
    // timeline, then override the hardware field so all downstream helpers
    // (buildCalendar, isInHorizon) automatically honor the new bound.
    const dynamicHorizon = computeHorizonDays(
      params.speciesMap ?? new Map(),
      params.profileMap ?? new Map(),
      safeNumber(params.hardware?.schedulingHorizonDays, HORIZON_FALLBACK_DAYS)
    );
    params.hardware.schedulingHorizonDays = dynamicHorizon;
    output.horizonDays = dynamicHorizon;

    // Build mutable calendar (now sized to the dynamic horizon)
    const calendar = this.buildCalendar(params.today, params.hardware, params.existingTasks ?? []);

    // ------ Empty-state guard: 0 weekly targets -> nothing to do --------------------------
    const targets = Array.isArray(params.weeklyTargets) ? params.weeklyTargets : [];
    if (targets.length === 0) {
      // Even with no targets we still tick active batches (they may need flushes / fridge expiry
      // warnings) so the UI keeps its consistency contract.
      const safeBatches = Array.isArray(params.activeBatches) ? params.activeBatches : [];
      this.tickActiveBatches(safeBatches, params.today, calendar, params.hardware, output);
      this.detectViolations(calendar, params.hardware, output);
      output.tasks = this.flattenCalendar(calendar);
      return output;
    }

    // ------ STEP 1: Demand calculation ------------------------------------------------------------------------------------
    const demands = targets
      .filter(t => t && t.isActive)
      .map(target => {
        const profile = params.profileMap.get(target.speciesId);
        const species = params.speciesMap.get(target.speciesId);
        if (!profile || !species) return null;
        return this.computeDemand(target, species, profile);
      })
      .filter((d): d is DemandResult => d !== null);

    // ------ STEP 2: Apply fridge reduction ---------------------------------------------------------------------
    const adjustedDemands = (demands.length > 0 ? demands : [])
      .map(d => this.applyFridgeReduction(d, params.fridgeSummary, params.fridgeThresh))
      .sort((a, b) => safeNumber(a.profile?.priorityLevel, 3) - safeNumber(b.profile?.priorityLevel, 3));

    // ------ STEP 3: Generate production chain tasks ---------------------------------------------
    // Phase 5 Step 2: horizon is now dynamic - params.hardware.schedulingHorizonDays
    // was overwritten at the top of run() with computeHorizonDays().
    const horizonEnd = addDays(params.today, safeNumber(params.hardware?.schedulingHorizonDays, HORIZON_FALLBACK_DAYS));

    for (const demand of adjustedDemands) {
      // Empty-species guard: species may have been deleted since the target row was created.
      const species = params.speciesMap.get(demand.speciesId);
      if (!species) continue;
      const speciesCode = this.getSpeciesCode(species?.commonName ?? '');

      const interval: TargetInterval = normalizeInterval(demand.targetInterval);
      const stepDays = INTERVAL_DAYS[interval];

      let anchor = new Date(demand.weekStartDate + 'T12:00:00');
      if (isNaN(anchor.getTime())) {
        anchor = new Date(params.today);
      }

      // Fast-forward anchor to the start of the relevant window (e.g. today or slightly before)
      // We want to generate chains for any week/cycle that might have tasks falling within the
      // horizon. To be safe, start from today - 90 days and go up to horizonEnd.
      let currentAnchor = new Date(anchor);
      const safePast = addDays(params.today, -90);
      while (currentAnchor < safePast) {
        currentAnchor = addDays(currentAnchor, stepDays);
      }

      while (currentAnchor <= horizonEnd) {
        const weekDemand = {
          ...demand,
          weekStartDate: currentAnchor.toISOString().split('T')[0],
          targetInterval: interval,
        };
        this.generateProductionChain(weekDemand, species, speciesCode, params.today, calendar, params.hardware, output);
        // Phase 5: advance by interval days, not always 7. WEEKLY stays 7, MONTHLY becomes 28.
        currentAnchor = addDays(currentAnchor, stepDays);
      }
    }

    // ------ STEP 4: Pack PC runs across calendar ---------------------------------------------------
    this.packPCRuns(calendar, params.hardware, output);

    // ------ STEP 5: Tick active batches (colonization timers) ---------------
    this.tickActiveBatches(params.activeBatches ?? [], params.today, calendar, params.hardware, output);

    // ------ STEP 6: LC depletion checks ------------------------------------------------------------------------------
    this.reconcileLC(output.tasks, params.speciesMap, output, calendar, params.today, params.hardware);

    // ------ STEP 7: Raw material depletion ------------------------------------------------------------------------
    this.reconcileInventory(output.tasks, params.rawMaterials, params.usageRecipes, params.hardware, output);

    // ------ STEP 8: Scan for constraint violations ------------------------------------------------
    this.detectViolations(calendar, params.hardware, output);

    // ------ STEP 9: Flatten calendar to ordered task list ---------------------------
    output.tasks = this.flattenCalendar(calendar);

    return output;
  }

  // ------ STEP 1: DEMAND CALCULATOR ---------------------------------------------------------------------------------------

  private computeDemand(
    target: WeeklyTarget,
    species: Species,
    profile: SpeciesProfile
  ): DemandResult {
    // Defensive numeric normalization: any missing field becomes 0 instead of NaN/undefined.
    const T = safeNumber(target?.targetBlocksPerWk, 0);
    const maxGen = safeNumber(profile?.maxGenerations, 2);

    const bulkBlocksNeeded = T;

    // Calculate backwards from final generation
    const genBagsNeeded = new Array(maxGen).fill(0);
    genBagsNeeded[maxGen - 1] = T; // Highest gen maps 1:1 with bulk blocks

    const ratio = safeNumber(profile?.gen1ToGen2Ratio, 10) || 1;
    for (let i = maxGen - 2; i >= 0; i--) {
      // ratio is gen1_to_gen2_ratio (implies genN to genN+1 ratio)
      genBagsNeeded[i] = Math.ceil(safeNumber(genBagsNeeded[i + 1], 0) / ratio);
    }

    const totalGrainBagsPerWeek = genBagsNeeded.reduce((sum, n) => sum + safeNumber(n, 0), 0);

    // Bulk PC demand: only HWFP species use PC for bulk
    const totalBulkBagsPerWeek =
      species?.bulkPrepMethod === 'PC' ? bulkBlocksNeeded : 0;

    // LC consumption (Gen 1)
    const lcMlPerWeek = safeNumber(genBagsNeeded[0], 0) * safeNumber(species?.lcInjectionVolumeMl, 0);

    return {
      speciesId: target?.speciesId,
      speciesName: species?.commonName ?? '',
      weeklyBlocks: T,
      bulkBlocksNeeded,
      genBagsNeeded,
      totalGrainBagsPerWeek,
      totalBulkBagsPerWeek,
      lcMlPerWeek,
      profile,
      weekStartDate: target?.weekStartDate ?? '',
      // Phase 5: carry the cadence flag forward so the weekly-loop in `run()` can branch.
      targetInterval: normalizeInterval(target?.targetInterval),
    };
  }

  // ------ STEP 2: FRIDGE REDUCTION ------------------------------------------------------------------------------------------

  private applyFridgeReduction(
    demand: DemandResult,
    fridgeSummary: Map<number, FridgeSummaryRow>,
    fridgeThresh: Map<number, FridgeThreshold>
  ): AdjustedDemand {
    const fridgeRow = fridgeSummary?.get(demand.speciesId);
    const threshold = fridgeThresh?.get(demand.speciesId);

    const available  = safeNumber(fridgeRow?.netAvailable, 0);
    const minThresh  = safeNumber(threshold?.minGen2Bags, 2);
    const restockTo  = safeNumber(threshold?.targetGen2Bags, 5);

    const maxGen = safeNumber(demand.profile?.maxGenerations, 2);
    const weeklyNeed     = safeNumber(demand.genBagsNeeded?.[maxGen - 1], 0);
    const pullFromFridge = Math.min(available, weeklyNeed);
    const produceNew     = weeklyNeed - pullFromFridge;

    // After pulling, will fridge be below minimum?
    const postPullLevel = available - pullFromFridge;
    const needsRestock  = postPullLevel < minThresh;
    const restockQty    = needsRestock ? Math.max(0, restockTo - postPullLevel) : 0;

    // New Gen bags needed for new production + fridge restock
    const genBagsAdjusted = [...(demand.genBagsNeeded ?? [])];
    genBagsAdjusted[maxGen - 1] = produceNew + restockQty;

    const ratio = safeNumber(demand.profile?.gen1ToGen2Ratio, 10) || 1;
    for (let i = maxGen - 2; i >= 0; i--) {
      genBagsAdjusted[i] = Math.ceil(safeNumber(genBagsAdjusted[i + 1], 0) / ratio);
    }

    return {
      ...demand,
      finalGenBagsFromFridge: pullFromFridge,
      finalGenBagsNewProduction: produceNew,
      finalGenBagsToRestock: restockQty,
      genBagsAdjusted,
    };
  }

  // ------ STEP 3: PRODUCTION CHAIN GENERATOR ---------------------------------------------------------

  private generateProductionChain(
    demand: AdjustedDemand,
    species: Species,
    speciesCode: string,
    today: Date,
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    const p = demand.profile ?? ({} as SpeciesProfile);
    const maxGen = safeNumber(p.maxGenerations, 2);

    // Start production chain based on the Weekly Target's anchor date
    // Note: ensure we parse it as local time to avoid timezone shifts
    let anchorDate = new Date(demand.weekStartDate + 'T12:00:00');
    if (isNaN(anchorDate.getTime())) {
      anchorDate = new Date(today);
    }

    // Calculate dates for each generation FORWARDS
    const inocDates = new Array(maxGen);
    const pcDates = new Array(maxGen);

    // First generation (LC to Gen1)
    inocDates[0] = shiftIfClosed(new Date(anchorDate), hw, 1);
    pcDates[0] = shiftIfClosed(addDays(inocDates[0], -1), hw, -1);

    // Middle and final generations
    for (let i = 1; i < maxGen; i++) {
        // Gen N inoculates after Gen N-1 finishes colonizing
        const prevColonizationDays = i === 1 ? safeNumber(p.lcToGen1DaysMax, 0) : safeNumber(p.gen2ColonizationDaysMax, 0);
        inocDates[i] = shiftIfClosed(addDays(inocDates[i - 1], prevColonizationDays), hw, 1);
        pcDates[i] = shiftIfClosed(addDays(inocDates[i], -1), hw, -1);
    }

    // Bulk Inoculation
    const bulkInocDate = shiftIfClosed(addDays(inocDates[maxGen - 1], safeNumber(p.gen2ColonizationDaysMax, 0)), hw, 1);

    // ------ Schedule Grain Generations ---------------------------------------
    for (let i = 0; i < maxGen; i++) {
      const bagsToMake = safeNumber(demand.genBagsAdjusted?.[i], 0);
      if (bagsToMake <= 0) continue;

      const genNum = i + 1;

      // PC_RUN_GRAIN
      if (this.isInHorizon(pcDates[i], today, hw)) {
        this.addPCRequest(calendar, {
          runType: 'GRAIN',
          date: pcDates[i],
          speciesId: demand.speciesId,
          speciesCode,
          bagType: `GEN${genNum}_GRAIN`,
          bagCount: bagsToMake,
          deadlineDate: inocDates[i],
          batchId: generateBatchId(speciesCode, `G${genNum}`, pcDates[i], this.nextSeq(`${speciesCode}-G${genNum}`)),
        });
      }

      // INOCULATION / G2G
      if (this.isInHorizon(inocDates[i], today, hw)) {
        if (i === 0) {
          this.addTask(calendar, inocDates[i], {
            taskType: 'INOCULATE_GEN1',
            title: `Inoculate Gen1 Grain --- ${bagsToMake}-- ${demand.speciesName}`,
            speciesId: demand.speciesId,
            estimatedMins: estimateMins('INOCULATE_GEN1', hw, bagsToMake),
            status: 'PENDING',
            notes: `LC to Gen1 Grain. Requires ${bagsToMake} Gen1 bags.`,
          }, hw, output);
        } else {
          this.addTask(calendar, inocDates[i], {
            taskType: 'G2G_TRANSFER',
            title: `G2G Transfer --- ${safeNumber(demand.genBagsAdjusted?.[i-1], 0)}-- Gen${i} --- ${bagsToMake}-- Gen${genNum} ${demand.speciesName}`,
            speciesId: demand.speciesId,
            estimatedMins: estimateMins('G2G_TRANSFER', hw),
            status: 'PENDING',
            notes: `Scheduled to produce ${bagsToMake} Gen${genNum} bags.`,
          }, hw, output);
        }
      }
    }

    // ------ FRIDGE pull tasks ---------------------------------------------------------------------------------------------------------------
    if (safeNumber(demand.finalGenBagsFromFridge, 0) > 0 && this.isInHorizon(bulkInocDate, today, hw)) {
      this.addTask(calendar, bulkInocDate, {
        taskType: 'MOVE_TO_FRIDGE',
        title: `Pull ${demand.finalGenBagsFromFridge}-- ${demand.speciesName} Gen${maxGen} from Fridge`,
        speciesId: demand.speciesId,
        estimatedMins: estimateMins('MOVE_TO_FRIDGE', hw),
        status: 'PENDING',
        notes: `Pulling ${demand.finalGenBagsFromFridge} Gen${maxGen} bags from fridge buffer to meet bulk inoculation target.`,
      }, hw, output);
    }

    // ------ BULK inoculation ------------------------------------------------------------------------------------------------------------------
    const totalBulkToMake = safeNumber(demand.bulkBlocksNeeded, 0); // this uses both new + fridge
    if (totalBulkToMake > 0 && this.isInHorizon(bulkInocDate, today, hw)) {
      if (species?.bulkPrepMethod === 'PC') {
        const pcBulkDate = shiftIfClosed(addDays(bulkInocDate, -1), hw, -1);
        if (this.isInHorizon(pcBulkDate, today, hw)) {
          this.addPCRequest(calendar, {
            runType: 'BULK',
            date: pcBulkDate,
            speciesId: demand.speciesId,
            speciesCode,
            bagType: 'BULK_HWFP',
            bagCount: totalBulkToMake,
            deadlineDate: bulkInocDate,
            batchId: generateBatchId(speciesCode, 'BLK', pcBulkDate, this.nextSeq(`${speciesCode}-BLK`)),
          });
        }

        this.addTask(calendar, bulkInocDate, {
          taskType: 'INOCULATE_BULK',
          title: `Inoculate Bulk HWFP --- ${totalBulkToMake}-- ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('INOCULATE_BULK', hw),
          status: 'PENDING',
          notes: `Scheduled to inoculate ${totalBulkToMake} bulk blocks to meet target harvest goal.`,
        }, hw, output);

      } else if (species?.bulkPrepMethod === 'PASTEURIZE') {
        this.addTask(calendar, bulkInocDate, {
          taskType: 'PASTEURIZE_BULK_CVG',
          title: `Pasteurize CVG + Inoculate --- ${totalBulkToMake}-- ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('PASTEURIZE_BULK_CVG', hw) + estimateMins('INOCULATE_BULK', hw),
          status: 'PENDING',
          notes: `Scheduled to prepare and inoculate ${totalBulkToMake} pasteurized blocks to meet target harvest goal.`,
        }, hw, output);

      } else if (species?.bulkPrepMethod === 'NONE') {
        this.addTask(calendar, bulkInocDate, {
          taskType: 'LOAD_FRUITING_CHAMBER',
          title: `Load Fruiting Chamber --- ${totalBulkToMake}-- ${demand.speciesName}`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('LOAD_FRUITING_CHAMBER', hw),
          status: 'PENDING',
          notes: `Scheduled to move ${totalBulkToMake} bags to fruiting chamber to meet target harvest goal.`,
        }, hw, output);
      }
    }

    // ------ MOVE surplus GenN to Fridge ---------------------------------------------------------------------------------
    const surplusGen = safeNumber(demand.finalGenBagsToRestock, 0);
    if (surplusGen > 0 && this.isInHorizon(inocDates[maxGen - 1], today, hw)) {
      const moveFridgeDate = shiftIfClosed(addDays(inocDates[maxGen - 1], safeNumber(p.gen2ColonizationDaysMax, 0)), hw, 1);
      if (this.isInHorizon(moveFridgeDate, today, hw)) {
        this.addTask(calendar, moveFridgeDate, {
          taskType: 'MOVE_TO_FRIDGE',
          title: `Move ${surplusGen}-- ${demand.speciesName} Gen${maxGen} --- Fridge Buffer`,
          speciesId: demand.speciesId,
          estimatedMins: estimateMins('MOVE_TO_FRIDGE', hw),
          status: 'PENDING',
          notes: `Moving surplus Gen${maxGen} bags (${surplusGen} bags) produced during G2G transfer to fridge buffer.`,
        }, hw, output);
      }
    }
  }

  // ------ STEP 4: PC RUN BIN-PACKING ------------------------------------------------------------------------------------

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

      // 1. CONSOLIDATION PASS: Try to backfill existing runs up to 2 days prior
      const lookbackDate = addDays(req.date, -2);
      for (let d = new Date(lookbackDate); d < new Date(req.date); d = addDays(d, 1)) {
        if (remainingBags <= 0) break;

        const dayKey = toDateStr(d);
        const day = calendar.get(dayKey);
        if (!day) continue;

        // Find existing run of the same type with open slots
        const existingRun = (day.pcRuns ?? []).find(r => r.runType === req.runType);
        if (existingRun) {
          const usedSlots = existingRun.slots.reduce((s, sl) => s + sl.quantity, 0);
          const openSlots = hw.maxBagsPerPcRun - usedSlots;

          if (openSlots > 0) {
            const toPlace = Math.min(remainingBags, openSlots);
            existingRun.slots.push({ speciesId: req.speciesId, bagType: req.bagType, quantity: toPlace });
            existingRun.bagCount += toPlace;
            remainingBags -= toPlace;

            // Update the existing PC task title to reflect the new total
            const taskType = req.runType === 'GRAIN' ? 'PC_RUN_GRAIN' : req.runType === 'BULK' ? 'PC_RUN_BULK' : 'PC_RUN_MICROLAB';
            const pcTask = day.tasks.find(t => t.taskType === taskType);
            if (pcTask) {
              pcTask.title = `PC Run [${req.runType}] --- ${existingRun.bagCount} bags (Consolidated)`;
            }
          }
        }
      }

      if (remainingBags <= 0) continue;

      // 2. NORMAL PASS: Try to place on preferred date first, then scan forward to deadline
      const startDate = new Date(req.date);
      const endDate = new Date(req.deadlineDate);

      for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
        if (remainingBags <= 0) { placed = true; break; }

        const dayKey = toDateStr(d);
        const day = calendar.get(dayKey);
        if (!day) continue;

        const pcRuns = day.pcRuns ?? [];
        const grainRuns = pcRuns.filter(r => r.runType === 'GRAIN').length;
        const bulkRuns  = pcRuns.filter(r => r.runType === 'BULK').length;
        const mlabRuns  = pcRuns.filter(r => r.runType === 'MICROLAB').length;
        const totalRuns = grainRuns + bulkRuns + mlabRuns;

        // Hard constraint: no more than (maxPcRunsPerDay * pcUnitCount)
        if (totalRuns >= (hw.maxPcRunsPerDay * hw.pcUnitCount)) continue;

        // (Removed artificial same-day constraint for MICROLAB vs GRAIN/BULK)
        // They will be in separate PC runs naturally because of the runType grouping.

        // Try to fill an existing same-type run first
        const existingRun = pcRuns.find(r => r.runType === req.runType);
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
          day.pcRuns = day.pcRuns ?? [];
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
            title: `PC Run [${req.runType}] --- ${toPlace} bags (${req.speciesCode})`,
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

  // ------ STEP 5: TICK ACTIVE BATCHES ------------------------------------------------------------------------------

  private tickActiveBatches(
    batches: Batch[],
    today: Date,
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    const safeBatches = Array.isArray(batches) ? batches : [];
    for (const batch of safeBatches) {
      if (!batch) continue;

      // Check colonization completion
      if (batch.status === 'INCUBATING' && batch.colonizationTarget) {
        const targetDate = fromDateStr(batch.colonizationTarget);
        if (today >= targetDate) {
          // Batch is past its colonization target --- flag for review
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

      // Auto-generate next flush sequence for fruiting batches
      if (batch.status === 'FRUITING' && batch.fruitingTargetEnd) {
        let currentFlushDate = fromDateStr(batch.fruitingTargetEnd);
        let flushNum = (batch.flushCount ?? 0) + 1;
        const maxFlushes = 3; // Typically stop predicting after 3 flushes

        while (flushNum <= maxFlushes && this.isInHorizon(currentFlushDate, today, hw)) {
          // 1. Harvest Task
          this.addTask(calendar, currentFlushDate, {
            taskType: 'HARVEST',
            title: `Harvest Flush ${flushNum} --- ${batch.batchId}`,
            speciesId: batch.speciesId,
            batchId: batch.id,
            flushNumber: flushNum,
            dependsOnBatchId: batch.id,
            estimatedMins: estimateMins('HARVEST', hw),
            status: 'PENDING',
          }, hw, output);

          // 2. Soak Task (next day)
          const soakDate = addDays(currentFlushDate, 1);
          if (this.isInHorizon(soakDate, today, hw) && flushNum < maxFlushes) {
            this.addTask(calendar, soakDate, {
              taskType: 'SOAK_BLOCKS', // Assuming this task type is valid or maps to a generic labor task
              title: `Soak Blocks after Flush ${flushNum} --- ${batch.batchId}`,
              speciesId: batch.speciesId,
              batchId: batch.id,
              dependsOnBatchId: batch.id,
              estimatedMins: 30, // 30 mins to soak blocks
              status: 'PENDING',
              notes: `Submerge blocks in cold water for 12-24 hours to rehydrate for flush ${flushNum + 1}.`,
            }, hw, output);
          }

          // Advance to next flush (typically 7-10 days after soak)
          // Cordyceps doesn't soak/flush twice, but standard blocks do.
          currentFlushDate = addDays(soakDate, 7);
          flushNum++;
        }
      }
    }
  }

  // ------ STEP 6: LC RECONCILIATION ------------------------------------------------------------------------------------

  private reconcileLC(
    tasks: Partial<Task>[],
    speciesMap: Map<number, Species>,
    output: SchedulerOutput,
    calendar: Map<string, DayEntry>,
    today: Date,
    hw: HardwareSettings
  ): void {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    // Build per-species LC consumption from scheduled INOCULATE_GEN1 tasks
    const consumption: Map<number, number> = new Map();
    for (const task of safeTasks) {
      if (!task) continue;
      if (task.taskType === 'INOCULATE_GEN1' && task.speciesId != null) {
        const current = consumption.get(task.speciesId) ?? 0;
        const species = speciesMap.get(task.speciesId);
        if (species) {
          consumption.set(task.speciesId, current + safeNumber(species.lcInjectionVolumeMl, 0));
        }
      }
    }

    // Check against available LC per species
    for (const [speciesId, totalMl] of consumption.entries()) {
      const species = speciesMap.get(speciesId);
      if (!species) continue;

      const available = safeNumber(species.lcVolumeMlAvailable, 0);
      output.lcDeltas[speciesId] = -totalMl;

      if (totalMl > available || (available - totalMl) < safeNumber(species.lcRestockThresholdMl, 0)) {
        // Let engine schedule INOCULATE_LC (requires MICROLAB PC) and PREP_LC today

        // 1. Prepare Liquid Culture (make broth, sterilize)
        this.addPCRequest(calendar, {
          runType: 'MICROLAB',
          bagType: 'LC_JAR',
          bagCount: 1, // Let's assume 1 jar of 500mL
          speciesId,
          speciesCode: species.commonName,
          date: today,
          deadlineDate: addDays(today, 2),
          batchId: generateBatchId(species.commonName, 'LC', today, this.nextSeq(`LC-${speciesId}`))
        });

        // 2. Add INOCULATE_LC (Agar to LC)
        const inocDate = addDays(today, 1); // after sterilization
        this.addTask(calendar, inocDate, {
          taskType: 'INOCULATE_LC',
          title: `Inoculate LC (${species.commonName})`,
          speciesId,
          estimatedMins: estimateMins('INOCULATE_LC', hw),
          status: 'PENDING',
          notes: `LC levels critically low (needs ${totalMl}mL, has ${available}mL). Transfer from Agar Plate or Spore Print to new LC.`
        }, hw, output);

        output.warnings.push({
          type: 'LC_LOW',
          date: toDateStr(today),
          message: `${species.commonName} LC will drop below threshold (need ${totalMl}mL, ${available}mL available). Scheduled PREP_LC and INOCULATE_LC.`,
          taskRef: `${species.commonName}-LC`,
          severity: totalMl > available ? 'ERROR' : 'WARNING',
        });
      }
    }
  }

  // ------ STEP 7: RAW MATERIAL RECONCILIATION ------------------------------------------------------

  private reconcileInventory(
    tasks: Partial<Task>[],
    rawMaterials: Map<number, RawMaterial>,
    recipes: MaterialUsageRecipe[],
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    // Running totals per material
    const consumed: Map<number, number> = new Map();

    for (const task of safeTasks) {
      if (!task || !task.taskType) continue;
      const taskRecipes = (recipes ?? []).filter(r => r.taskType === task.taskType);
      for (const recipe of taskRecipes) {
        let bagCount = 1;
        if (task.title) {
          const match = task.title.match(/---\s*(\d+)\s*(bags|--)/);
          if (match && match[1]) {
            bagCount = parseInt(match[1], 10) || 1;
          }
        }
        const weightFactor = safeNumber(task.bagWeightLbs, hw.defaultBagWeightLbs) / (hw.defaultBagWeightLbs || 1);
        const total = safeNumber(recipe.quantityPerBag, 0) * bagCount * weightFactor;
        consumed.set(recipe.materialId, (consumed.get(recipe.materialId) ?? 0) + total);
      }
    }

    for (const [materialId, totalConsumed] of consumed.entries()) {
      const material = rawMaterials.get(materialId);
      if (!material) continue;

      const remaining = safeNumber(material.quantityOnHand, 0) - totalConsumed;
      output.inventoryDeltas.push({ materialId, delta: -totalConsumed });

      if (remaining < safeNumber(material.reorderThreshold, 0)) {
        output.warnings.push({
          type: 'MATERIAL_LOW',
          date: new Date().toISOString().split('T')[0],
          message: `${material.materialName} will drop to ${remaining.toFixed(1)} ${material.unit} ` +
                   `after scheduled tasks - below reorder threshold of ${material.reorderThreshold} ${material.unit}.`,
          taskRef: `REORDER-${material.materialName}`,
          severity: remaining <= 0 ? 'ERROR' : 'WARNING',
        });
      }
    }
  }

  // ------ STEP 8: CONSTRAINT VIOLATION SCAN ------------------------------------------------------------

  private detectViolations(
    calendar: Map<string, DayEntry>,
    hw: HardwareSettings,
    output: SchedulerOutput
  ): void {
    for (const [dateStr, day] of calendar.entries()) {
      const pcRuns = day?.pcRuns ?? [];
      // Check PC run ceiling
      const maxAllowed = hw.maxPcRunsPerDay * hw.pcUnitCount;
      if (pcRuns.length > maxAllowed) {
        output.warnings.push({
          type: 'PC_CAPACITY',
          date: dateStr,
          message: `Day ${dateStr} has ${pcRuns.length} PC runs scheduled but max is ${maxAllowed} (${hw.maxPcRunsPerDay} runs * ${hw.pcUnitCount} PCs).`,
          taskRef: 'PC_CAP',
          severity: 'ERROR',
        });
      }

      // (Removed illegal MICROLAB + GRAIN/BULK mixing on same day check)
      // Since they are on different runs, there is no contamination risk.

      // Flag over-budget days (Q4: soft warning, not block)
      const dayTasks = day?.tasks ?? [];
      const totalMins = dayTasks.reduce((s, t) => s + safeNumber(t.estimatedMins, 0), 0);
      if (totalMins > hw.dailyAvailableMins) {
        day.isOverBudget = true;
        output.warnings.push({
          type: 'OVER_BUDGET',
          date: dateStr,
          message: `Day ${dateStr}: ${totalMins} min of tasks vs ${hw.dailyAvailableMins} min budget. ` +
                    `Flagged OVER_BUDGET_WARNING - tasks remain scheduled.`,
          taskRef: 'TIME_BUDGET',
          severity: 'WARNING',
        });
        // Mark all tasks on this day as over-budget
        for (const task of dayTasks) {
          if (task?.status === 'PENDING') {
            task.status = 'OVER_BUDGET_WARNING';
          }
        }
      }
    }
  }

  // ------ HELPERS ---------------------------------------------------------------------------------------------------------------------------------------------

  private buildCalendar(
    today: Date,
    hw: HardwareSettings,
    existingTasks: Task[]
  ): Map<string, DayEntry> {
    const calendar = new Map<string, DayEntry>();
    // Phase 5 Step 2: hw.schedulingHorizonDays has already been overridden by
    // computeHorizonDays() at the top of run(), so the calendar naturally sizes
    // itself to the slowest species' biological timeline.
    const horizon = Math.max(1, safeNumber(hw?.schedulingHorizonDays, HORIZON_FALLBACK_DAYS));
    for (let i = 0; i < horizon; i++) {
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
    const safeExisting = Array.isArray(existingTasks) ? existingTasks : [];
    for (const task of safeExisting) {
      if (!task) continue;
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
      tasks.push(...(day?.tasks ?? []));
    }
    return tasks;
  }

  private getSpeciesCode(commonName: string): string {
    const codes: Record<string, string> = {
      'Jack Frost':   'JF',
      "Lion's Mane":  'LM',
      'Pink Oyster':  'PO',
      'Blue Oyster':  'BO',
      'Yellow Oyster':'YO',
      'Cordyceps':    'COR',
    };
    return codes[commonName] ?? (commonName?.substring(0, 3).toUpperCase() ?? 'XXX');
  }
}
