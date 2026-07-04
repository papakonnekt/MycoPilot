// =============================================================
// MycoScheduler — Shared TypeScript Types
// Used by both client and server
// =============================================================

// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────

export type SubstrateType = 'HWFP' | 'CVG' | 'GRAIN' | 'MIXED';
export type BulkPrepMethod = 'PC' | 'PASTEURIZE' | 'NONE';

export type PCRunType = 'GRAIN' | 'BULK' | 'MICROLAB';
export type BagType = string;

export type BatchStage = string;

export type BatchStatus =
  | 'INCUBATING'
  | 'COLONIZED'
  | 'IN_FRIDGE'
  | 'FRUITING'
  | 'HARVESTED'
  | 'SPENT'
  | 'CONTAMINATED'
  | 'DISPOSED'
  | 'EXPIRED';

export type PCRunStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';

export type TaskType =
  // Production
  | 'PC_RUN_GRAIN'
  | 'PC_RUN_BULK'
  | 'PC_RUN_MICROLAB'
  | 'INOCULATE_GEN1'
  | 'G2G_TRANSFER'
  | 'INOCULATE_BULK'
  | 'PASTEURIZE_BULK_CVG'
  | 'LOAD_FRUITING_CHAMBER'
  | 'START_FRUITING'
  | 'HARVEST'
  | 'SOAK_BLOCKS'
  | 'MARK_SPENT_TOSS'
  | 'MOVE_TO_FRIDGE'
  // Genetics / Micro-lab
  | 'PREP_LC'
  | 'PREP_AGAR'
  | 'INOCULATE_LC'
  | 'COLLECT_SPORE_PRINT'
  | 'CLONE_BEST_CLUSTER'
  | 'START_NEW_LC_FROM_SPORE'
  | 'FLAG_SENESCENCE'
  // Supply
  | 'REORDER_MATERIAL'
  // Review
  | 'REVIEW_BATCH'
  | 'OVER_BUDGET_FLAG';

export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'SKIPPED'
  | 'RESCHEDULED'
  | 'FLAGGED'
  | 'OVER_BUDGET_WARNING';

export type OriginType = 'SPORE_PRINT' | 'CLONE' | 'COMMERCIAL_LC' | 'AGAR';

// Phase 5: Target cadence — WEEKLY emits demand every week, MONTHLY only every 4 weeks
// (the Monthly Rotator slot).
export type TargetInterval = 'WEEKLY' | 'MONTHLY';

export type MaterialType = 'SPORE_PRINT' | 'AGAR_PLATE' | 'LC_JAR' | 'LC_SYRINGE';
export type GeneticMaterialStatus = 'ACTIVE' | 'DEPLETED' | 'CONTAMINATED' | 'ARCHIVED';
export type ContamType = 'TRICH' | 'BACTERIA' | 'MOLD' | 'UNKNOWN';
export type ContamStage = 'POST_STERILIZATION' | 'POST_INOCULATION' | 'INCUBATION' | 'FRUITING';
export type MaterialUnit = 'lbs' | 'kg' | 'bricks' | 'units' | 'mL' | 'bags';
export type TransactionType = 'RESTOCK' | 'CONSUMED' | 'ADJUSTMENT' | 'EXPIRED' | 'WASTE';

export type SchedulerWarningType =
  | 'OVER_BUDGET'
  | 'PC_CAPACITY'
  | 'IMPOSSIBLE_DEADLINE'
  | 'FRIDGE_LOW'
  | 'LC_LOW'
  | 'MATERIAL_LOW'
  | 'SENESCENT'
  | 'FRIDGE_EXPIRY';

// ─────────────────────────────────────────────────────────────
// DOMAIN MODELS (mirror database rows)
// ─────────────────────────────────────────────────────────────

export interface Species {
  id: number;
  commonName: string;
  scientificName?: string;
  substrateType: SubstrateType;
  bulkPrepMethod: BulkPrepMethod;
  lcVolumeMlAvailable: number;
  lcInjectionVolumeMl: number;
  lcRestockThresholdMl: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
}

export interface SpeciesProfile {
  id: number;
  speciesId: number;
  lcToGen1DaysMin: number;
  lcToGen1DaysMax: number;
  gen2ColonizationDaysMin: number;
  gen2ColonizationDaysMax: number;
  bulkColonizationDaysMin: number;
  bulkColonizationDaysMax: number;
  fruitingDaysMin: number;
  fruitingDaysMax: number;
  gen1ToGen2Ratio: number;
  gen2ToBulkSpawnPct: number;
  targetBiologicalEfficiency: number;
  senescenceThresholdPct: number;
  maxGenerations: number;
  sporeCloneFreq: number;
  priorityLevel: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface HardwareSettings {
  id?: number;
  profileName?: string;
  maxPcRunsPerDay: number;
  maxBagsPerPcRun: number;
  grainCycleMins: number;
  grainPrepCoolMins: number;
  bulkCycleMins: number;
  bulkPrepCoolMins: number;
  microlabCycleMins: number;
  microlabPrepCoolMins: number;
  homogeneousByBagType: boolean;
  dailyAvailableMins: number;
  schedulingHorizonDays: number;
  pcUnitCount: number;
  defaultBagWeightLbs: number;
  labDays?: number[]; // Array of days (0-6) the lab is open
  isActive: boolean;
  updatedAt?: string;
}

export interface FridgeThreshold {
  id: number;
  speciesId: number;
  minGen2Bags: number;
  targetGen2Bags: number;
  updatedAt: string;
}

export interface WeeklyTarget {
  id: number;
  speciesId: number;
  targetBlocksPerWk: number;
  targetWeightGrams?: number;
  weekStartDate: string;
  isActive: boolean;
  createdAt: string;
  // Phase 5: WEEKLY = schedule every 7 days (default),
  // MONTHLY = schedule once every 4 weeks (Monthly Rotator slot).
  // Optional in type to remain backward-compatible with rows that
  // pre-date the 006 migration (we treat missing as 'WEEKLY' at the
  // engine boundary).
  targetInterval?: TargetInterval;
}

export interface Lineage {
  id: number;
  speciesId: number;
  lineageCode: string;
  originType: OriginType;
  gen0Date?: string;
  generationCount: number;
  isActive: boolean;
  isSenescent: boolean;
  senescenceFlaggedAt?: string;
  notes?: string;
  createdAt: string;
}

export interface GeneticMaterial {
  id: number;
  lineageId: number;
  speciesId: number;
  batchId: string;
  materialType: MaterialType;
  volumeMlAtCreation?: number;
  unitCount: number;
  status: GeneticMaterialStatus;
  createdAt: string;
  expiresAt?: string;
  storageLocation?: string;
  notes?: string;
}

export interface PCRun {
  id: number;
  batchId: string;
  runType: PCRunType;
  scheduledDate: string;
  scheduledStartTime?: string;
  status: PCRunStatus;
  bagCount: number;
  cycleDurationMins: number;
  totalTimeMins: number;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  // Joined
  slots?: PCRunSlot[];
}

export interface PCRunSlot {
  id: number;
  pcRunId: number;
  speciesId?: number;
  bagType: BagType;
  quantity: number;
  // Joined
  speciesName?: string;
}

export interface Batch {
  id: number;
  batchId: string;
  speciesId: number;
  lineageId?: number;
  parentBatchId?: number;
  sourcePcRunId?: number;
  sourceGeneticId?: number;
  stage: BatchStage;
  status: BatchStatus;
  quantity: number;
  colonizationStart?: string;
  colonizationTarget?: string;
  fruitingStart?: string;
  fruitingTargetEnd?: string;
  flushCount: number;
  createdAt: string;
  updatedAt: string;
  // Joined
  speciesName?: string;
  daysUntilColonized?: number;
  daysUntilFruiting?: number;
}

export interface BagUnit {
  id: number;
  bagId: string;
  batchId: number;
  status: BatchStatus;
  contamType?: ContamType;
  contamLoggedAt?: string;
  notes?: string;
}

export interface FridgeBuffer {
  id: number;
  speciesId: number;
  batchId: number;
  quantityAvailable: number;
  reservedQuantity: number;
  dateAdded: string;
  dateExpires: string;
  notes?: string;
}

export interface FridgeSummaryRow {
  speciesId: number;
  commonName: string;
  netAvailable: number;
  batchCount: number;
  earliestExpiry: string;
  minGen2Bags: number;
  targetGen2Bags: number;
  belowThreshold: boolean;
}

export interface HarvestRecord {
  id: number;
  batchId: number;
  bagUnitId?: number;
  lineageId: number;
  flushNumber: number;
  harvestDate: string;
  wetWeightGrams: number;
  dryWeightGrams?: number;
  blockWeightGrams?: number;
  biologicalEfficiency?: number;
  notes?: string;
}

export interface ContamLog {
  id: number;
  bagUnitId?: number;
  batchId: number;
  pcRunId?: number;
  sourceGeneticId?: number;
  lineageId?: number;
  contamType?: ContamType;
  contamStage?: ContamStage;
  loggedAt: string;
  notes?: string;
}

export interface Task {
  id: number;
  taskDate: string;
  taskType: TaskType;
  title: string;
  description?: string;
  speciesId?: number;
  batchId?: number;
  pcRunId?: number;
  lineageId?: number;
  estimatedMins?: number;
  status: TaskStatus;
  flushNumber?: number;
  dependsOnTaskId?: number;
  dependsOnBatchId?: number;
  isAutoGenerated: boolean;
  rescheduledFromDate?: string;
  completedAt?: string;
  createdBy: string;
  notes?: string;
  createdAt: string;
  bagWeightLbs?: number;
  // Joined / computed
  speciesName?: string;
  batchRef?: string;
  isOverdue?: boolean;
}

export interface RawMaterial {
  id: number;
  materialName: string;
  unit: MaterialUnit;
  quantityOnHand: number;
  reorderThreshold: number;
  reorderQuantity: number;
  costPerUnit?: number;
  supplierName?: string;
  notes?: string;
  updatedAt: string;
  // Computed
  isLow?: boolean;
}

export interface MaterialUsageRecipe {
  id: number;
  taskType: TaskType;
  materialId: number;
  quantityPerBag: number;
  notes?: string;
}

export interface MaterialTransaction {
  id: number;
  materialId: number;
  transactionType: TransactionType;
  quantity: number;
  relatedTaskId?: number;
  relatedBatchId?: number;
  transactionDate: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────
// SCHEDULER TYPES
// ─────────────────────────────────────────────────────────────

export interface SchedulerWarning {
  type: SchedulerWarningType;
  date: string;
  message: string;
  taskRef: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

export interface DemandResult {
  speciesId: number;
  speciesName: string;
  weeklyBlocks: number;
  bulkBlocksNeeded: number;
  genBagsNeeded: number[];
  totalGrainBagsPerWeek: number;
  totalBulkBagsPerWeek: number;
  lcMlPerWeek: number;
  profile: SpeciesProfile;
  weekStartDate: string;
  // Phase 5: carries the cadence flag from the WeeklyTarget through
  // to the production-chain generator. Defaults to WEEKLY when absent
  // so the engine still works on rows that pre-date the 006 migration.
  targetInterval?: TargetInterval;
}

export interface AdjustedDemand extends DemandResult {
  finalGenBagsFromFridge: number;
  finalGenBagsNewProduction: number;
  finalGenBagsToRestock: number;
  genBagsAdjusted: number[];
}

export interface PCRunDraft {
  runType: PCRunType;
  date: string;
  bagCount: number;
  cycleMins: number;
  slots: Array<{
    speciesId?: number;
    bagType: BagType;
    quantity: number;
  }>;
}

export interface DayEntry {
  date: string;
  tasks: Partial<Task>[];
  pcRuns: PCRunDraft[];
  totalMins: number;
  isOverBudget: boolean;
}

export interface SchedulerOutput {
  tasks: Partial<Task>[];
  warnings: SchedulerWarning[];
  inventoryDeltas: Array<{ materialId: number; delta: number }>;
  lcDeltas: Record<number, number>;
  pcRunDrafts: PCRunDraft[];
  // Phase 5 Step 2: dynamic horizon, in days, computed by the engine from
  // the slowest active species' biological timeline (lcToGen1DaysMax +
  // gen2ColonizationDaysMax + bulkColonizationDaysMax + fruitingDaysMax).
  // Routes forward this so the client can paginate / truncate safely.
  horizonDays: number;
}

// ─────────────────────────────────────────────────────────────
// API RESPONSE WRAPPERS
// ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: SchedulerWarning[];
}

export interface DailyView {
  date: string;
  tasks: Task[];
  totalEstimatedMins: number;
  dailyBudgetMins: number;
  isOverBudget: boolean;
  warningCount: number;
}

export interface TracebackReport {
  contamEvent: ContamLog;
  pcRun?: PCRun & { contamRate: string };
  lcSource?: GeneticMaterial;
  parentBatch?: Batch;
}
