// =============================================================
// Myco Lab — Centralized API client
// Thin fetch wrapper around the Express server at :3001
// =============================================================
//
// Type convention: server returns snake_case JSON for every row
// from SQLite. The outer envelope of /tasks/today is camelCase
// because the route constructs a DailyView literal whose keys are
// shared/types.ts camelCase names. Everywhere else is snake_case.
// No transform layer — types match the server JSON exactly.
// =============================================================

const API_BASE = import.meta.env.VITE_API_BASE || 
  (typeof window !== 'undefined' && window.location.origin 
    ? `${window.location.origin}/api` 
    : 'http://localhost:3001/api');

// ─────────────────────────────────────────────────────────────
// ENVELOPE
// ─────────────────────────────────────────────────────────────

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
  warnings?: unknown[]
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })

  let body: ApiEnvelope<T> | null = null
  try {
    body = (await res.json()) as ApiEnvelope<T>
  } catch {
    // Non-JSON body — keep null and let status decide.
  }

  if (!res.ok || body?.success === false) {
    const message =
      body?.error ??
      (typeof body?.message === 'string' ? body.message : null) ??
      `Request failed: ${res.status} ${res.statusText}`
    throw new ApiError(message, res.status, body)
  }

  // Server wraps in { success, data }. If data is undefined, return
  // the envelope cast instead so the caller can introspect.
  return (body?.data ?? (body as unknown as T)) as T
}

// ─────────────────────────────────────────────────────────────
// ROW TYPES — mirror the SQLite columns returned by the routes.
// Where a route joins multiple tables, the column list is the
// union of every column named in the SQL (see server/src/routes/*).
// ─────────────────────────────────────────────────────────────

/** task row — see server/src/routes/tasks.ts (`SELECT t.*`). */
export interface TaskRow {
  id: number
  task_date: string
  task_type: string
  title: string
  description: string | null
  species_id: number | null
  batch_id: number | null
  pc_run_id: number | null
  lineage_id: number | null
  estimated_mins: number | null
  status: string
  flush_number: number | null
  depends_on_task_id: number | null
  depends_on_batch_id: number | null
  is_auto_generated: number | boolean
  rescheduled_from_date: string | null
  completed_at: string | null
  created_by: string
  notes: string | null
  created_at: string
  // Joined (task list + range endpoints)
  species_name?: string | null
  batch_ref?: string | null
  is_overdue?: number | boolean
}

/** /tasks/today envelope — keys come from the DailyView literal in
 * server/src/routes/tasks.ts (camelCase). */
export interface DailyViewPayload {
  date: string
  tasks: TaskRow[]
  totalEstimatedMins: number
  dailyBudgetMins: number
  isOverBudget: boolean
  warningCount: number
}

/** batch row — see server/src/routes/batches.ts (`SELECT b.*`). */
export interface BatchRow {
  id: number
  batch_id: string
  species_id: number
  lineage_id: number | null
  parent_batch_id: number | null
  source_pc_run_id: number | null
  source_genetic_id: number | null
  stage: string
  status: string
  quantity: number
  colonization_start: string | null
  colonization_target: string | null
  fruiting_start: string | null
  fruiting_target_end: string | null
  flush_count: number
  created_at: string
  updated_at: string
  // Joined
  species_name?: string
  days_to_colonized?: number | null
  days_to_harvest?: number | null
  // /incubating only
  days_remaining?: number | null
  pct_complete?: number | null
  is_contaminated?: number | boolean
}

/** raw_material row — server/src/routes/inventory.ts */
export interface RawMaterialRow {
  id: number
  material_name: string
  unit: string
  quantity_on_hand: number
  reorder_threshold: number
  reorder_quantity: number
  cost_per_unit: number | null
  supplier_name: string | null
  notes: string | null
  updated_at: string
  is_low: number | boolean
}

/** species lc-status row — server/src/routes/inventory.ts lcStatus */
export interface SpeciesLCStatusRow {
  id: number
  common_name: string
  lc_volume_ml_available: number
  lc_restock_threshold_ml: number
  lc_is_low: number | boolean
}

/** fridge_summary view row */
export interface FridgeSummaryRow {
  species_id: number
  common_name: string
  net_available: number | null
  batch_count: number | null
  earliest_expiry: string | null
  min_gen2_bags: number | null
  target_gen2_bags: number | null
  below_threshold: number | boolean | null
}

/** fridge_buffer row joined w/ species + batch (active + expired) */
export interface FridgeBufferRow {
  id: number
  species_id: number
  batch_id: number
  quantity_available: number
  reserved_quantity: number
  date_added: string
  date_expires: string
  notes: string | null
  // Joined
  common_name?: string
  batch_ref?: string | null
  colonization_target?: string | null
  days_until_expiry?: number | null
}

export interface FridgePayload {
  active: FridgeBufferRow[]
  expired: FridgeBufferRow[]
}

/** material_transaction row joined w/ raw_material */
export interface MaterialTransactionRow {
  id: number
  material_id: number
  transaction_type: string
  quantity: number
  related_task_id: number | null
  related_batch_id: number | null
  transaction_date: string
  notes: string | null
  material_name?: string
  unit?: string
}

export interface InventoryPayload {
  materials: RawMaterialRow[]
  lcStatus: SpeciesLCStatusRow[]
  fridgeSummary: FridgeSummaryRow[]
  recentTransactions: MaterialTransactionRow[]
}

/** hardware_settings row */
export interface HardwareSettingsRow {
  id: number
  profile_name: string
  max_pc_runs_per_day: number
  max_bags_per_pc_run: number
  grain_cycle_mins: number
  grain_prep_cool_mins: number
  bulk_cycle_mins: number
  bulk_prep_cool_mins: number
  microlab_cycle_mins: number
  microlab_prep_cool_mins: number
  homogeneous_by_bag_type: number | boolean
  daily_available_mins: number
  scheduling_horizon_days: number
  is_active: number | boolean
  updated_at: string
}

/** fridge_thresholds row joined w/ common_name */
export interface FridgeThresholdRow {
  id: number
  species_id: number
  min_gen2_bags: number
  target_gen2_bags: number
  updated_at: string
  common_name?: string
}

/** weekly_targets row joined w/ common_name */
export interface WeeklyTargetRow {
  id: number
  species_id: number
  target_blocks_per_wk: number
  target_weight_grams: number | null
  week_start_date: string
  is_active: number | boolean
  created_at: string
  common_name?: string
}

/** species row joined with species_profile + thresholds + fridge + target */
export interface SettingsSpeciesRow {
  id: number
  common_name: string
  scientific_name: string | null
  substrate_type: string
  bulk_prep_method: string
  lc_volume_ml_available: number
  lc_injection_volume_ml: number
  lc_restock_threshold_ml: number
  notes: string | null
  is_active: number | boolean
  created_at: string
  // species_profile (snake_case columns from JOIN)
  species_id?: number
  lc_to_gen1_days_min?: number
  lc_to_gen1_days_max?: number
  gen2_colonization_days_min?: number
  gen2_colonization_days_max?: number
  bulk_colonization_days_min?: number
  bulk_colonization_days_max?: number
  fruiting_days_min?: number
  fruiting_days_max?: number
  gen1_to_gen2_ratio?: number
  gen2_to_bulk_spawn_pct?: number
  target_biological_efficiency?: number
  senescence_threshold_pct?: number
  max_generations?: number
  spore_clone_freq?: number
  effective_from?: string
  effective_to?: string | null
}

export interface SettingsPayload {
  hardware: HardwareSettingsRow
  species: SettingsSpeciesRow[]
  fridgeThresholds: FridgeThresholdRow[]
  weeklyTargets: WeeklyTargetRow[]
}

/** /species row — joined with profile + thresholds + summary + target */
export interface SpeciesRow {
  id: number
  common_name: string
  scientific_name: string | null
  substrate_type: string
  bulk_prep_method: string
  lc_volume_ml_available: number
  lc_injection_volume_ml: number
  lc_restock_threshold_ml: number
  notes: string | null
  is_active: number | boolean
  created_at: string
  // profile
  species_id?: number
  lc_to_gen1_days_min?: number
  lc_to_gen1_days_max?: number
  gen2_colonization_days_min?: number
  gen2_colonization_days_max?: number
  bulk_colonization_days_min?: number
  bulk_colonization_days_max?: number
  fruiting_days_min?: number
  fruiting_days_max?: number
  gen1_to_gen2_ratio?: number
  gen2_to_bulk_spawn_pct?: number
  target_biological_efficiency?: number
  senescence_threshold_pct?: number
  max_generations?: number
  spore_clone_freq?: number
  effective_from?: string
  effective_to?: string | null
  // thresholds
  min_gen2_bags?: number | null
  target_gen2_bags?: number | null
  // fridge_summary (LEFT JOIN — may be null when no buffer)
  fridge_stock?: number | null
  fridge_low?: number | boolean | null
  // weekly_targets
  weekly_target?: number | null
}

/** /species/:id/lineages row — joined totals */
export interface LineageRow {
  id: number
  species_id: number
  lineage_code: string
  origin_type: string
  gen0_date: string | null
  generation_count: number
  is_active: number | boolean
  is_senescent: number | boolean
  senescence_flagged_at: string | null
  notes: string | null
  created_at: string
  total_harvests?: number
  avg_be_90d?: number | null
}

/** /scheduler/warnings payload */
export interface SchedulerWarning {
  type: string
  date: string
  message: string
  taskRef: string
  severity: 'INFO' | 'WARNING' | 'ERROR'
}

export interface SchedulerWarningsPayload {
  warnings: SchedulerWarning[]
  asOf: string | null
}

/** harvest_record row (best-effort — server doesn't expose a /harvests
 * endpoint, but the column names match schema.sql line 263). */
export interface HarvestRecordRow {
  id: number
  batch_id: number
  bag_unit_id: number | null
  lineage_id: number
  flush_number: number
  harvest_date: string
  wet_weight_grams: number
  dry_weight_grams: number | null
  block_weight_grams: number | null
  biological_efficiency: number | null
  notes: string | null
}

// ─────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────

/** GET /tasks/today */
export function getTodayTasks(): Promise<DailyViewPayload> {
  return request<DailyViewPayload>('/tasks/today')
}

/** GET /tasks/range?from=&to= */
export function getTasksInRange(
  start: string,
  end: string,
): Promise<TaskRow[]> {
  const qs = new URLSearchParams({ from: start, to: end }).toString()
  return request<TaskRow[]>(`/tasks/range?${qs}`)
}

/** PATCH /tasks/:id/complete */
export function completeTask(
  id: string | number,
): Promise<{ taskId: string | number; sideEffects: string[] }> {
  return request(`/tasks/${id}/complete`, { method: 'PATCH' })
}

/** GET /batches */
export function getBatches(): Promise<BatchRow[]> {
  return request<BatchRow[]>('/batches')
}

/** GET /batches/incubating */
export function getIncubatingBatches(): Promise<BatchRow[]> {
  return request<BatchRow[]>('/batches/incubating')
}

/** PATCH /tasks/batch/:batchId/mark-spent  (server-mapped Q3 kill switch) */
export function markBatchSpent(
  id: string | number,
): Promise<{ batchId: string | number; tasksKilled: number; message: string }> {
  return request(`/tasks/batch/${id}/mark-spent`, { method: 'PATCH' })
}

/** GET /inventory */
export function getInventory(): Promise<InventoryPayload> {
  return request<InventoryPayload>('/inventory')
}

/** GET /inventory/fridge */
export function getFridge(): Promise<FridgePayload> {
  return request<FridgePayload>('/inventory/fridge')
}

/** DELETE /inventory/fridge/:id/expire */
export function expireFridgeEntry(
  id: string | number,
): Promise<{ success: boolean; message: string }> {
  return request(`/inventory/fridge/${id}/expire`, { method: 'DELETE' })
}

/** POST /inventory/restock */
export function restockMaterial(
  materialId: number,
  quantity: number,
  notes?: string,
): Promise<{ success: boolean; message: string }> {
  return request('/inventory/restock', {
    method: 'POST',
    body: JSON.stringify({ materialId, quantity, notes }),
  })
}

/** POST /inventory/lc-restock */
export function restockLc(
  speciesId: number,
  volumeMl: number,
): Promise<{ success: boolean; message: string }> {
  return request('/inventory/lc-restock', {
    method: 'POST',
    body: JSON.stringify({ speciesId, volumeMl }),
  })
}

/** GET /settings */
export function getSettings(): Promise<SettingsPayload> {
  return request<SettingsPayload>('/settings')
}

/** PUT /settings/hardware */
export function updateHardwareSettings(
  patch: Partial<HardwareSettingsRow>,
): Promise<{ success: boolean; message: string }> {
  return request('/settings/hardware', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

/** PUT /settings/species/:id/profile */
export function updateSpeciesProfile(
  speciesId: number,
  patch: {
    lcToGen1DaysMin: number
    lcToGen1DaysMax: number
    gen2ColonizationDaysMin: number
    gen2ColonizationDaysMax: number
    bulkColonizationDaysMin: number
    bulkColonizationDaysMax: number
    fruitingDaysMin: number
    fruitingDaysMax: number
    gen1ToGen2Ratio: number
    gen2ToBulkSpawnPct: number
    targetBiologicalEfficiency: number
    senescenceThresholdPct: number
    maxGenerations: number
    sporeCloneFreq: number
  },
): Promise<{ success: boolean; message: string }> {
  return request(`/settings/species/${speciesId}/profile`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

/** PUT /settings/weekly-targets */
export function updateWeeklyTargets(
  targets: Array<{ speciesId: number; targetBlocksPerWk: number }>,
): Promise<{ success: boolean; message: string }> {
  return request('/settings/weekly-targets', {
    method: 'PUT',
    body: JSON.stringify({ targets }),
  })
}

/** GET /species */
export function getSpecies(): Promise<SpeciesRow[]> {
  return request<SpeciesRow[]>('/species')
}

/** GET /species/:id/lineages */
export function getLineagesForSpecies(
  speciesId: number,
): Promise<LineageRow[]> {
  return request<LineageRow[]>(`/species/${speciesId}/lineages`)
}

/** GET /scheduler/warnings */
export function getSchedulerWarnings(): Promise<SchedulerWarningsPayload> {
  return request<SchedulerWarningsPayload>('/scheduler/warnings')
}

/** POST /scheduler/run */
export function runScheduler(): Promise<{
  tasksGenerated: number
  warnings: SchedulerWarning[]
  warningCount: number
  horizon: string
}> {
  return request('/scheduler/run', { method: 'POST' })
}
