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

// ─────────────────────────────────────────────────────────────
// SERVER URL — runtime override via localStorage
//
// Priority chain:
//   1. localStorage "myco_server_url"  ← user-set at runtime (survives APK restarts)
//   2. VITE_API_BASE env var           ← baked in at build time (CI/CD default)
//   3. Tailscale IP                    ← Capacitor fallback
//   4. window.location.origin/api      ← browser dev fallback
// ─────────────────────────────────────────────────────────────

const LS_KEY = 'myco_server_url'

/** Persist a custom server base URL (e.g. "http://192.168.1.10:3001"). */
export function saveServerUrl(raw: string): void {
  // Strip trailing slash; normalise to include /api if missing
  let url = raw.trim().replace(/\/+$/, '')
  if (!url.endsWith('/api')) url = `${url}/api`
  localStorage.setItem(LS_KEY, url)
}

/** Clear the runtime override — reverts to build-time / Tailscale default. */
export function clearServerUrl(): void {
  localStorage.removeItem(LS_KEY)
}

/** Read the currently configured server URL (without /api suffix, for display). */
export function getConfiguredServerUrl(): string {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
  if (stored) return stored.replace(/\/api$/, '')
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE.replace(/\/api$/, '')
  if (typeof window !== 'undefined' && (window as any).Capacitor) return 'http://100.76.45.35:3001'
  return typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:3001'
}

function getApiBase(): string {
  // 1. Runtime override (user-set)
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
  if (stored) return stored

  // 2. Build-time env (e.g. set via GitHub Actions secret)
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE

  // 3. Capacitor wrapper → Tailscale default
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    return 'http://100.76.45.35:3001/api'
  }

  // 4. Browser dev / desktop
  return typeof window !== 'undefined' && window.location.origin
    ? `${window.location.origin}/api`
    : 'http://localhost:3001/api'
}

// Re-evaluated on every import to pick up the latest localStorage value.
// Views that call saveServerUrl() should trigger a page reload or re-mount
// to force a fresh API_BASE. The simplest approach: window.location.reload().
let API_BASE = getApiBase()

/** Force a re-evaluation of the API base (call after saveServerUrl). */
export function refreshApiBase(): void {
  API_BASE = getApiBase()
}

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
  recipe_id: number | null
  lineage_id: number | null
  parent_batch_id: number | null
  source_pc_run_id: number | null
  source_genetic_id: number | null
  stage: string
  protocol_markdown?: string | null
  status: string
  quantity: number
  weight_per_bag_lbs: number | null
  colonization_start: string | null
  colonization_target: string | null
  fruiting_start: string | null
  fruiting_target_end: string | null
  flush_count: number
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  species_name?: string
  days_to_colonized?: number | null
  days_to_harvest?: number | null
  // /incubating only
  days_remaining?: number | null
  pct_complete?: number | null
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
  agar_plates: number
  spore_prints: number
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
  default_bag_weight_lbs?: number
  pc_unit_count: number
  lab_days: string
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

// weekly_targets row joined w/ common_name.
// Phase 5 Step 2: target_interval governs cadence. Optional because legacy
// rows (pre-006 migration) may not have the column populated yet -- the
// engine treats missing as 'WEEKLY'.
export interface WeeklyTargetRow {
  id: number
  species_id: number
  target_blocks_per_wk: number
  target_weight_grams: number | null
  week_start_date: string
  // Phase 5: 'WEEKLY' (default) or 'MONTHLY'. Optional in the row payload
  // so older backends that omit the column still typecheck.
  target_interval?: 'WEEKLY' | 'MONTHLY' | null
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
  protocol_markdown?: string | null
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
  priority_level?: number
  agar_plates?: number
  spore_prints?: number
  effective_from?: string
  effective_to?: string | null
}

export interface SettingsPayload {
  isSetup: boolean
  hardware?: HardwareSettingsRow
  species?: SettingsSpeciesRow[]
  fridgeThresholds?: FridgeThresholdRow[]
  weeklyTargets?: WeeklyTargetRow[]
}

export function setupSettings(
  payload: {
    hardware: Partial<HardwareSettingsRow>,
    recipes?: Array<{
      name: string,
      notes?: string,
      ingredients?: Array<{ ingredient: string, amount?: number, unit?: string }>
    }>,
    species: Array<{
      commonName: string,
      substrateType?: string,
      bulkPrepMethod?: string,
      
      // Timelines
      lcToGen1DaysMin?: number,
      lcToGen1DaysMax?: number,
      gen2ColonizationDaysMin?: number,
      gen2ColonizationDaysMax?: number,
      bulkColonizationDaysMin?: number,
      bulkColonizationDaysMax?: number,
      fruitingDaysMin?: number,
      fruitingDaysMax?: number,

      // Limits & Stats
      gen1ToGen2Ratio?: number,
      gen2ToBulkSpawnPct?: number,
      targetBiologicalEfficiency?: number,
      senescenceThresholdPct?: number,
      maxGenerations?: number,
      sporeCloneFreq?: number,
      priorityLevel?: number,

      // Targets
      weeklyTargetBlocks?: number,
      fridgeTargetBags?: number,
      fridgeMinBags?: number,

      // Inventory & Incubating
      startingLcVolumeMl?: number,
      sterilizedGrains?: Array<{ weightLbs: number, quantity: number }>,
      sterilizedSubstrate?: Array<{ weightLbs: number, quantity: number }>,
      incubating?: Array<{ stage: string, quantity: number, colonizationPct: number }>
    }>
  }
): Promise<{ success: boolean; message: string }> {
  return request('/settings/setup', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
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
  agar_plates: number
  spore_prints: number
  notes: string | null
  protocol_markdown?: string | null
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
  priority_level?: number
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
  history_json?: string
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

/** PATCH /tasks/:id/reschedule */
export function rescheduleTask(
  id: string | number,
  newDate: string
): Promise<{ success: boolean; message: string }> {
  return request(`/tasks/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ newDate }) })
}

/** PATCH /tasks/:id/contamination */
export function flagTaskContamination(
  id: string | number,
  type: string,
  qty: number,
  notes: string
): Promise<{ success: boolean; message: string; tasksKilled?: number }> {
  return request(`/tasks/${id}/contamination`, { method: 'PATCH', body: JSON.stringify({ type, qty, notes }) })
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

/** POST /inventory/materials */
export function createMaterial(
  payload: { materialName: string; unit: string; quantityOnHand?: number; reorderThreshold?: number; reorderQuantity?: number; costPerUnit?: number; notes?: string }
): Promise<{ success: boolean; data: { id: number } }> {
  return request('/inventory/materials', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** PUT /inventory/materials/:id */
export function updateMaterial(
  id: number,
  payload: { materialName: string; unit: string; quantityOnHand?: number; reorderThreshold?: number; reorderQuantity?: number; costPerUnit?: number; notes?: string }
): Promise<{ success: boolean }> {
  return request(`/inventory/materials/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** DELETE /inventory/materials/:id */
export function deleteMaterial(
  id: number
): Promise<{ success: boolean }> {
  return request(`/inventory/materials/${id}`, {
    method: 'DELETE',
  })
}



// ── SETTINGS ──────────────────────────────────────────────────

export async function getSettings(): Promise<SettingsPayload> {
  return request<SettingsPayload>('/settings')
}

export async function createBackup(): Promise<{ message: string }> {
  return request<{ message: string }>('/settings/backup', { method: 'POST' })
}

export async function resetSetup(): Promise<{ message: string }> {
  return request<{ message: string }>('/settings/reset', { method: 'POST' })
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
    maxGenerations?: number
    sporeCloneFreq?: number
    priorityLevel?: number
    lcInjectionVolumeMl?: number
    minGen2Bags?: number
    targetGen2Bags?: number
    targetBlocksPerWk?: number
    // Phase 5 Step 2: cadence flag forwarded to /settings/species/:id/profile.
    // Server persists via the weekly_targets upsert at the tail of that route.
    targetInterval?: 'WEEKLY' | 'MONTHLY'
  },
): Promise<{ success: boolean; message: string }> {
  return request(`/settings/species/${speciesId}/profile`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

// PUT /settings/weekly-targets.
// Phase 5 Step 2: targetInterval carries the cadence flag through.
// Missing values are coerced to 'WEEKLY' by the server.
export function updateWeeklyTargets(targets: Array<{
  speciesId: number
  targetBlocksPerWk: number
  targetInterval?: 'WEEKLY' | 'MONTHLY'
}>): Promise<void> {
  return request('/settings/weekly-targets', {
    method: 'PUT',
    body: JSON.stringify({ targets })
  })
}

/**
 * Phase 5 Step 2: lightweight read of weekly_targets rows for clients that
 * don't want to fetch the full /settings payload. Returns the WeeklyTargetRow
 * shape (joined w/ common_name) from /settings/weekly-targets.
 */
export function getWeeklyTargets(): Promise<WeeklyTargetRow[]> {
  return request<WeeklyTargetRow[]>('/settings/weekly-targets')
}

export function saveSpeciesProtocol(id: number | string, protocol_markdown: string): Promise<void> {
  return request(`/settings/species/${id}/protocol`, {
    method: 'PUT',
    body: JSON.stringify({ protocol_markdown })
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

/**
 * Phase 5 Step 2: dynamic horizon metadata.
 * GET /scheduler/horizon -> { horizonDays, hasSpecies, speciesCount, startDate, endDate, fallback }
 */
export interface SchedulerHorizonPayload {
  horizonDays: number
  hasSpecies: boolean
  speciesCount: number
  startDate: string
  endDate: string
  fallback: number
}

export function getSchedulerHorizon(): Promise<SchedulerHorizonPayload> {
  return request<SchedulerHorizonPayload>('/scheduler/horizon')
}

/** POST /scheduler/run */
export function runScheduler(): Promise<{ success: boolean; tasksCreated?: number; warnings?: SchedulerWarning[] }> {
  return request<{ success: boolean; tasksCreated?: number; warnings?: SchedulerWarning[] }>('/scheduler/run', { method: 'POST' })
}

export function getSchedulerCapacity(): Promise<{ success: boolean; data: CapacityDay[] }> {
  return request<{ success: boolean; data: CapacityDay[] }>('/scheduler/capacity')
}

// ── CRUD Helpers ──────────────────────────────────────────────

export function createBatch(data: Partial<BatchRow>): Promise<{ id: number }> {
  return request('/batches', { method: 'POST', body: JSON.stringify(data) })
}

export function updateBatch(id: string | number, data: Partial<BatchRow>): Promise<void> {
  return request(`/batches/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function updateBatchProgress(id: string | number, pct: number): Promise<void> {
  return request(`/batches/${id}/progress`, { method: 'PUT', body: JSON.stringify({ pct }) })
}

export function deleteBatch(id: string | number): Promise<void> {
  return request(`/batches/${id}`, { method: 'DELETE' })
}

export function createLineage(speciesId: number | string, data: Partial<LineageRow>): Promise<{ id: number }> {
  return request(`/species/${speciesId}/lineages`, { method: 'POST', body: JSON.stringify(data) })
}

export function updateLineage(id: number | string, data: Partial<LineageRow>): Promise<void> {
  return request(`/species/lineages/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteLineage(id: number | string): Promise<void> {
  return request(`/species/lineages/${id}`, { method: 'DELETE' })
}

export function addFridgeItem(data: any): Promise<{ id: number }> {
  return request('/inventory/fridge', { method: 'POST', body: JSON.stringify(data) })
}

export function updateFridgeItem(id: number | string, data: any): Promise<void> {
  return request(`/inventory/fridge/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

// ─────────────────────────────────────────────────────────────
// RECIPE TYPES & ENDPOINTS
// ─────────────────────────────────────────────────────────────

export interface RecipeIngredient {
  id?: number
  ingredient: string
  amount?: number | null
  unit?: string | null
  notes?: string | null
}

export interface RecipeRow {
  id: number
  name: string
  notes: string | null
  is_active: number | boolean
  created_at: string
  ingredients: RecipeIngredient[]
}

/** GET /recipes */
export function getRecipes(): Promise<RecipeRow[]> {
  return request<RecipeRow[]>('/recipes')
}

/** GET /recipes/:id */
export function getRecipe(id: number | string): Promise<RecipeRow> {
  return request<RecipeRow>(`/recipes/${id}`)
}

/** POST /recipes */
export function createRecipe(data: {
  name: string
  notes?: string
  ingredients: RecipeIngredient[]
}): Promise<{ id: number }> {
  return request('/recipes', { method: 'POST', body: JSON.stringify(data) })
}

/** PUT /recipes/:id */
export function updateRecipe(id: number | string, data: {
  name: string
  notes?: string
  ingredients: RecipeIngredient[]
}): Promise<{ success: boolean; message: string }> {
  return request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

/** DELETE /recipes/:id */
export function deleteRecipe(id: number | string): Promise<{ success: boolean; message: string }> {
  return request(`/recipes/${id}`, { method: 'DELETE' })
}

// ─────────────────────────────────────────────────────────────
// BATCH ACTIONS (advance, contaminate, harvest)
// ─────────────────────────────────────────────────────────────

export interface AdvanceBatchResult {
  previousStage: string
  previousStatus: string
  nextStage: string
  nextStatus: string
  description: string
}

/** PUT /batches/:id/advance — auto-detects next stage, returns what will happen */
export function advanceBatch(id: number | string): Promise<{
  success: boolean
  message: string
  data: AdvanceBatchResult
}> {
  return request(`/batches/${id}/advance`, { method: 'PUT' })
}

/** PUT /batches/:id/contaminate */
export function contaminateBatch(
  id: number | string,
  contaminationType: 'TRICH' | 'BACTERIA' | 'MOLD' | 'WET_ROT' | 'UNKNOWN',
  quantity?: number,
  notes?: string,
): Promise<{ success: boolean; message: string }> {
  return request(`/batches/${id}/contaminate`, {
    method: 'PUT',
    body: JSON.stringify({ contaminationType, quantity, notes }),
  })
}

/** POST /batches/:id/harvest */
export function logHarvest(
  id: number | string,
  data: {
    flushNumber: number
    wetWeightGrams: number
    dryWeightGrams?: number
    blockWeightGrams?: number
    notes?: string
  },
): Promise<{ success: boolean; message: string; biological_efficiency?: number }> {
  return request(`/batches/${id}/harvest`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ─────────────────────────────────────────────────────────────
// HARVEST FORECAST
// ─────────────────────────────────────────────────────────────

export interface ForecastEntry {
  id: number
  batch_id: string
  species_name: string
  fruiting_target_end: string
  flush_count: number
  quantity: number
  days_to_harvest: number | null
}

/** GET /batches/forecast — active FRUITING batches with estimated harvest dates */
export function getHarvestForecast(): Promise<ForecastEntry[]> {
  return request<ForecastEntry[]>('/batches/forecast')
}

export interface PerformanceMatrixRow {
  species_id: number;
  species_name: string;
  recipe_id: number | null;
  recipe_name: string | null;
  avg_biological_efficiency: number;
  harvest_count: number;
}

/** GET /analytics/performance — average BE grouped by species and recipe */
export function getPerformanceMatrix(): Promise<PerformanceMatrixRow[]> {
  return request<PerformanceMatrixRow[]>('/analytics/performance')
}

export interface PcRunAnalyticsRow {
  pc_run_id: number;
  run_date: string;
  run_type: string;
  bag_count: number;
  contam_count: number;
  contam_rate: number;
}

/** GET /analytics/pc-runs — PC run history and contam rate */
export function getPcRunAnalytics(): Promise<PcRunAnalyticsRow[]> {
  return request<PcRunAnalyticsRow[]>('/analytics/pc-runs')
}

// ─────────────────────────────────────────────────────────────
// BATCH PHOTOS
// ─────────────────────────────────────────────────────────────

export interface BatchPhotoRow {
  id: number;
  batch_id: number;
  photo_data_b64: string;
  captured_at: string;
  notes: string | null;
}

export function getBatchPhotos(batchId: string | number): Promise<BatchPhotoRow[]> {
  return request<BatchPhotoRow[]>(`/batches/${batchId}/photos`)
}

export function saveBatchPhoto(batchId: string | number, b64Data: string, notes?: string): Promise<{ id: number }> {
  return request<{ id: number }>(`/batches/${batchId}/photos`, {
    method: 'POST',
    body: JSON.stringify({ photo_data_b64: b64Data, notes }),
  })
}
export interface CapacityDay { date: string; pc_runs: number; max_pc_runs: number; task_mins: number; max_task_mins: number; }
