// =============================================================
// Myco Lab — Settings (Phase 3 Step 2)
//
// Mobile-overhaul changes:
//  - H1 down to text-4xl/6xl.
//  - Hardware + Species cards stack to single-column on mobile
//    (grid-cols-1 md:grid-cols-12) — already the case, but the
//    inner number-field grid drops to grid-cols-1 sm:grid-cols-2
//    so wide inputs never overflow a 360dp screen.
//  - The "Run scheduler" button and Save button each carry
//    min-h-[44px] for touch.
//  - Toast is positioned via env(safe-area-inset-bottom) so it
//    never hides under the system gesture bar.
//  - Every input wrapper uses min-w-0 + overflow-x-hidden so
//    long numbers don't push the row out of the card.
//
// Data flow:
//   1. GET /api/settings → SettingsPayload
//   2. Hardware: PUT /settings/hardware (partial UPDATE — server uses COALESCE)
//   3. Species profiles: PUT /settings/species/:id/profile
//      (creates a NEW effective species_profile row, expiring the prior one)
//   4. After each save, POST /scheduler/run to regenerate tasks.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  Check,
  CircleNotch,
  Cpu,
  Flask,
  PlayCircle,
  Warning,
} from 'phosphor-react'

import {
  ApiError,
  getSettings,
  runScheduler,
  updateHardwareSettings,
  updateSpeciesProfile,
  type HardwareSettingsRow,
  type SettingsPayload,
  type SettingsSpeciesRow,
} from '../lib/api'
import { HelpTooltip } from '../components/HelpTooltip'
import { ServerUrlModal } from '../components/ServerUrlModal'
import { WifiHigh } from 'phosphor-react'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: SettingsPayload }

interface HardwareDraft {
  max_pc_runs_per_day: number
  max_bags_per_pc_run: number
  grain_cycle_mins: number
  grain_prep_cool_mins: number
  bulk_cycle_mins: number
  bulk_prep_cool_mins: number
  microlab_cycle_mins: number
  microlab_prep_cool_mins: number
  daily_available_mins: number
  scheduling_horizon_days: number
}

interface SpeciesDraft {
  id: number
  common_name: string
  lc_to_gen1_days_min: number
  lc_to_gen1_days_max: number
  gen2_colonization_days_min: number
  gen2_colonization_days_max: number
  bulk_colonization_days_min: number
  bulk_colonization_days_max: number
  fruiting_days_min: number
  fruiting_days_max: number
  gen1_to_gen2_ratio: number
  gen2_to_bulk_spawn_pct: number
  target_biological_efficiency: number
  senescence_threshold_pct: number
  max_generations: number
  spore_clone_freq: number
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function toHardwareDraft(row: HardwareSettingsRow): HardwareDraft {
  return {
    max_pc_runs_per_day: row.max_pc_runs_per_day,
    max_bags_per_pc_run: row.max_bags_per_pc_run,
    grain_cycle_mins: row.grain_cycle_mins,
    grain_prep_cool_mins: row.grain_prep_cool_mins,
    bulk_cycle_mins: row.bulk_cycle_mins,
    bulk_prep_cool_mins: row.bulk_prep_cool_mins,
    microlab_cycle_mins: row.microlab_cycle_mins,
    microlab_prep_cool_mins: row.microlab_prep_cool_mins,
    daily_available_mins: row.daily_available_mins,
    scheduling_horizon_days: row.scheduling_horizon_days,
  }
}

function toSpeciesDraft(row: SettingsSpeciesRow): SpeciesDraft {
  const num = (v: number | string | undefined | null, fallback: number): number => {
    if (v == null) return fallback
    const n = typeof v === 'string' ? parseFloat(v) : v
    return Number.isFinite(n) ? n : fallback
  }
  return {
    id: row.id,
    common_name: row.common_name,
    lc_to_gen1_days_min: num(row.lc_to_gen1_days_min, 14),
    lc_to_gen1_days_max: num(row.lc_to_gen1_days_max, 18),
    gen2_colonization_days_min: num(row.gen2_colonization_days_min, 12),
    gen2_colonization_days_max: num(row.gen2_colonization_days_max, 16),
    bulk_colonization_days_min: num(row.bulk_colonization_days_min, 12),
    bulk_colonization_days_max: num(row.bulk_colonization_days_max, 16),
    fruiting_days_min: num(row.fruiting_days_min, 5),
    fruiting_days_max: num(row.fruiting_days_max, 10),
    gen1_to_gen2_ratio: num(row.gen1_to_gen2_ratio, 10),
    gen2_to_bulk_spawn_pct: num(row.gen2_to_bulk_spawn_pct, 0.2),
    target_biological_efficiency: num(row.target_biological_efficiency, 0.5),
    senescence_threshold_pct: num(row.senescence_threshold_pct, 0.2),
    max_generations: num(row.max_generations, 8),
    spore_clone_freq: num(row.spore_clone_freq, 3),
  }
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null

export default function SettingsView() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    if (loadInFlight) return loadInFlight
    setState({ kind: 'loading' })
    const work = (async () => {
      try {
        const data = await getSettings()
        setState({ kind: 'ready', data })
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Could not load bench settings.'
        setState({ kind: 'error', message })
      }
    })()
    loadInFlight = work.finally(() => {
      loadInFlight = null
    })
    return loadInFlight
  }, [])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    void loadRef.current()
  }, [])

  if (state.kind === 'loading') return <SettingsSkeleton />
  if (state.kind === 'error') {
    return <SettingsError message={state.message} onRetry={load} />
  }

  return (
    <SettingsReady
      key={state.data.hardware.id + ':' + state.data.species.length}
      data={state.data}
      onReload={load}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────

function SettingsReady({
  data,
  onReload,
}: {
  data: SettingsPayload
  onReload: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [hwDraft, setHwDraft] = useState<HardwareDraft>(() =>
    toHardwareDraft(data.hardware),
  )
  const [speciesDrafts, setSpeciesDrafts] = useState<SpeciesDraft[]>(() =>
    data.species.map(toSpeciesDraft),
  )
  const [hwStatus, setHwStatus] = useState<SaveStatus>('idle')
  const [hwError, setHwError] = useState<string | null>(null)
  const [speciesStatus, setSpeciesStatus] = useState<Record<number, SaveStatus>>({})
  const [speciesError, setSpeciesError] = useState<Record<number, string | null>>({})
  const [runStatus, setRunStatus] = useState<SaveStatus>('idle')
  const [toast, setToast] = useState<string | null>(null)
  const [showUrlModal, setShowUrlModal] = useState(false)

  const hwDirty = useMemo(() => {
    const original = toHardwareDraft(data.hardware)
    return (Object.keys(original) as Array<keyof HardwareDraft>).some(
      (k) => original[k] !== hwDraft[k],
    )
  }, [data.hardware, hwDraft])

  useEffect(() => {
    if (hwStatus !== 'saved') return
    const t = window.setTimeout(() => setHwStatus('idle'), 1800)
    return () => window.clearTimeout(t)
  }, [hwStatus])
  useEffect(() => {
    const allSaved = Object.values(speciesStatus).every((s) => s !== 'saved')
    if (allSaved) return
    const t = window.setTimeout(() => {
      setSpeciesStatus((prev) => {
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          if (next[Number(k)] === 'saved') next[Number(k)] = 'idle'
        }
        return next
      })
    }, 1800)
    return () => window.clearTimeout(t)
  }, [speciesStatus])

  const handleSaveHardware = useCallback(async () => {
    if (!hwDirty || hwStatus === 'saving') return
    setHwStatus('saving')
    setHwError(null)
    try {
      await updateHardwareSettings(hwDraft)
      setHwStatus('saved')
      onReload()
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not save hardware settings.'
      setHwStatus('error')
      setHwError(message)
      window.setTimeout(() => setHwStatus('idle'), 2400)
    }
  }, [hwDraft, hwDirty, hwStatus, onReload])

  const handleSaveSpecies = useCallback(
    async (draft: SpeciesDraft) => {
      const id = draft.id
      setSpeciesStatus((prev) => ({ ...prev, [id]: 'saving' }))
      setSpeciesError((prev) => ({ ...prev, [id]: null }))
      try {
        await updateSpeciesProfile(id, {
          lcToGen1DaysMin: draft.lc_to_gen1_days_min,
          lcToGen1DaysMax: draft.lc_to_gen1_days_max,
          gen2ColonizationDaysMin: draft.gen2_colonization_days_min,
          gen2ColonizationDaysMax: draft.gen2_colonization_days_max,
          bulkColonizationDaysMin: draft.bulk_colonization_days_min,
          bulkColonizationDaysMax: draft.bulk_colonization_days_max,
          fruitingDaysMin: draft.fruiting_days_min,
          fruitingDaysMax: draft.fruiting_days_max,
          gen1ToGen2Ratio: draft.gen1_to_gen2_ratio,
          gen2ToBulkSpawnPct: draft.gen2_to_bulk_spawn_pct,
          targetBiologicalEfficiency: draft.target_biological_efficiency,
          senescenceThresholdPct: draft.senescence_threshold_pct,
          maxGenerations: draft.max_generations,
          sporeCloneFreq: draft.spore_clone_freq,
        })
        setSpeciesStatus((prev) => ({ ...prev, [id]: 'saved' }))
        onReload()
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not save species profile.'
        setSpeciesStatus((prev) => ({ ...prev, [id]: 'error' }))
        setSpeciesError((prev) => ({ ...prev, [id]: message }))
        window.setTimeout(() => {
          setSpeciesStatus((prev) => ({ ...prev, [id]: 'idle' }))
        }, 2400)
      }
    },
    [onReload],
  )

  const handleRunScheduler = useCallback(async () => {
    if (runStatus === 'saving') return
    setRunStatus('saving')
    try {
      const result = await runScheduler()
      setRunStatus('saved')
      setToast(`Scheduler ran · ${result.tasksGenerated} tasks · ${result.warningCount} warnings`)
      window.setTimeout(() => setToast(null), 3500)
      onReload()
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Scheduler run failed.'
      setRunStatus('error')
      setToast(message)
      window.setTimeout(() => setToast(null), 3500)
    } finally {
      window.setTimeout(() => setRunStatus('idle'), 1800)
    }
  }, [onReload, runStatus])

  return (
    <div className="relative">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto w-full max-w-6xl min-w-0"
      >
        {/* Header */}
        <div className="pt-2 min-w-0">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="eyebrow-tag">Settings</span>
          </div>
          <h1 className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-5xl leading-tight tracking-tight text-balance break-words" style={{ color: 'var(--surface-text)' }}>
            Bench configuration.
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: 'var(--surface-muted)' }}>
            Hardware caps, cycle times, and species biological timelines. Edits
            version-control species profiles. Re-run the scheduler after a save.
          </p>
        </div>

        {/* Top action: Run scheduler */}
        <div className="mt-6 md:mt-7">
          <div className="lab-card-accent flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 md:px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
                <PlayCircle size={18} weight="regular" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="font-semibold leading-snug break-words" style={{ color: 'var(--surface-text)' }}>
                    Regenerate scheduled tasks
                  </div>
                  <HelpTooltip
                    title="Run Scheduler"
                    text="Re-runs the constraint-solving engine to create, update, or cancel tasks based on the current hardware and species profiles. Safe to run anytime — idempotent."
                  />
                </div>
                <div className="text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
                  POST /api/scheduler/run
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRunScheduler}
              disabled={runStatus === 'saving'}
              className={
                'group min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ' +
                (runStatus === 'saved'
                  ? 'bg-bio-green text-surface-900'
                  : runStatus === 'error'
                  ? 'bg-danger-dim text-danger'
                  : 'bg-bio-green text-surface-900 active:scale-[0.97]')
              }
            >
              {runStatus === 'saving' ? (
                <CircleNotch size={14} weight="regular" className="animate-spin" />
              ) : runStatus === 'saved' ? (
                <Check size={14} weight="regular" />
              ) : (
                <PlayCircle size={14} weight="regular" className="transition-transform duration-300 group-hover:scale-[1.08]" />
              )}
              <span>
                {runStatus === 'saving'
                  ? 'Running…'
                  : runStatus === 'saved'
                  ? 'Done'
                  : runStatus === 'error'
                  ? 'Failed'
                  : 'Run scheduler'}
              </span>
            </button>
          </div>
        </div>

        {/* Server Connection card */}
        <div className="mt-3">
          <div className="lab-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 md:px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
                <WifiHigh size={18} weight="bold" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="font-semibold leading-snug" style={{ color: 'var(--surface-text)' }}>Server URL</div>
                  <HelpTooltip
                    title="Server Connection"
                    text="The URL of the Docker host running the Myco Lab backend. Change this if you switch between local WiFi and Tailscale. Saved to localStorage — survives app restarts."
                  />
                </div>
                <div className="text-[12px] font-mono truncate" style={{ color: 'var(--surface-muted)' }}>
                  {typeof localStorage !== 'undefined' && localStorage.getItem('myco_server_url')
                    ? localStorage.getItem('myco_server_url')
                    : 'Default (Tailscale / build-time)'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowUrlModal(true)}
              className="btn-ghost min-h-[44px] shrink-0"
            >
              <WifiHigh size={14} weight="regular" />
              <span>Change</span>
            </button>
          </div>
        </div>

        <div className="mt-6 md:mt-8 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 min-w-0">
          <section className="md:col-span-5 min-w-0">
            <HardwareSection
              draft={hwDraft}
              onChange={setHwDraft}
              dirty={hwDirty}
              status={hwStatus}
              error={hwError}
              onSave={handleSaveHardware}
            />
          </section>

          <section className="md:col-span-7 min-w-0">
            <SpeciesSection
              drafts={speciesDrafts}
              statuses={speciesStatus}
              errors={speciesError}
              onChange={setSpeciesDrafts}
              onSave={handleSaveSpecies}
            />
          </section>
        </div>

        <div className="mt-10 md:mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          <span>End of settings</span>
        </div>
      </motion.div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="fixed left-1/2 -translate-x-1/2 z-50 px-4"
            style={{ bottom: 'calc(max(env(safe-area-inset-bottom,0px),16px) + 5rem)' }}
            role="status"
          >
            <div className="lab-card px-4 py-3 flex items-center gap-2 text-sm max-w-[min(92vw,32rem)]" style={{ color: 'var(--surface-text)' }}>
              <Warning size={18} weight="regular" className="text-warn shrink-0" />
              <span className="break-words min-w-0">{toast}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showUrlModal && <ServerUrlModal onClose={() => setShowUrlModal(false)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// HARDWARE SECTION
// ─────────────────────────────────────────────────────────────

function HardwareSection({
  draft,
  onChange,
  dirty,
  status,
  error,
  onSave,
}: {
  draft: HardwareDraft
  onChange: (next: HardwareDraft) => void
  dirty: boolean
  status: SaveStatus
  error: string | null
  onSave: () => void
}) {
  const set = <K extends keyof HardwareDraft>(k: K, v: HardwareDraft[K]) =>
    onChange({ ...draft, [k]: v })

  return (
    <div className="lab-card p-4 md:p-6 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
        <div className="min-w-0 flex-1">
          <span className="eyebrow-tag">
            Hardware
          </span>
          <h2 className="mt-3 font-sans font-bold text-2xl leading-tight tracking-tight text-balance" style={{ color: 'var(--surface-text)' }}>
            PC capacity & cycles
          </h2>
        </div>
        <div className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
          <Cpu size={20} weight="regular" />
        </div>
      </div>
      <p className="text-[13px] mb-5" style={{ color: 'var(--surface-muted)' }}>
        How many runs fit in a day, and how long each cycle cooks and cools.
      </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <NumberField
            label="Max PC runs / day"
            hint="Hard daily cap"
            value={draft.max_pc_runs_per_day}
            onChange={(v) => set('max_pc_runs_per_day', v)}
            min={1}
            max={12}
            step={1}
          />
          <NumberField
            label="Max bags / PC run"
            hint="Per cycle"
            value={draft.max_bags_per_pc_run}
            onChange={(v) => set('max_bags_per_pc_run', v)}
            min={1}
            max={20}
            step={1}
          />
          <NumberField
            label="Grain cycle"
            suffix="min"
            value={draft.grain_cycle_mins}
            onChange={(v) => set('grain_cycle_mins', v)}
            min={30}
            max={480}
            step={5}
          />
          <NumberField
            label="Grain cool-down"
            suffix="min"
            value={draft.grain_prep_cool_mins}
            onChange={(v) => set('grain_prep_cool_mins', v)}
            min={30}
            max={240}
            step={5}
          />
          <NumberField
            label="Bulk cycle"
            suffix="min"
            value={draft.bulk_cycle_mins}
            onChange={(v) => set('bulk_cycle_mins', v)}
            min={30}
            max={480}
            step={5}
          />
          <NumberField
            label="Bulk cool-down"
            suffix="min"
            value={draft.bulk_prep_cool_mins}
            onChange={(v) => set('bulk_prep_cool_mins', v)}
            min={30}
            max={240}
            step={5}
          />
          <NumberField
            label="Microlab cycle"
            suffix="min"
            value={draft.microlab_cycle_mins}
            onChange={(v) => set('microlab_cycle_mins', v)}
            min={10}
            max={180}
            step={5}
          />
          <NumberField
            label="Microlab cool-down"
            suffix="min"
            value={draft.microlab_prep_cool_mins}
            onChange={(v) => set('microlab_prep_cool_mins', v)}
            min={15}
            max={180}
            step={5}
          />
          <NumberField
            label="Daily budget"
            suffix="min"
            hint="Soft warning threshold"
            value={draft.daily_available_mins}
            onChange={(v) => set('daily_available_mins', v)}
            min={60}
            max={1440}
            step={15}
          />
          <NumberField
            label="Horizon"
            suffix="days"
            hint="Scheduler window"
            value={draft.scheduling_horizon_days}
            onChange={(v) => set('scheduling_horizon_days', v)}
            min={7}
            max={90}
            step={1}
          />
        </div>

      <div className="mt-6 flex items-center justify-between gap-3 min-w-0">
        <div className="text-[12px] font-mono truncate" style={{ color: 'var(--surface-muted)' }}>
          PUT /api/settings/hardware
        </div>
        <SaveButton
          status={status}
          disabled={!dirty}
          dirty={dirty}
          onClick={onSave}
        />
      </div>
      {error && (
        <div className="mt-3 text-[12px] font-mono break-words" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SPECIES SECTION
// ─────────────────────────────────────────────────────────────

function SpeciesSection({
  drafts,
  statuses,
  errors,
  onChange,
  onSave,
}: {
  drafts: SpeciesDraft[]
  statuses: Record<number, SaveStatus>
  errors: Record<number, string | null>
  onChange: (next: SpeciesDraft[]) => void
  onSave: (draft: SpeciesDraft) => void
}) {
  const updateOne = useCallback(
    (id: number, patch: Partial<SpeciesDraft>) => {
      onChange(
        drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      )
    },
    [drafts, onChange],
  )

  return (
    <div className="lab-card p-4 md:p-6 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
        <div className="min-w-0 flex-1">
          <span className="eyebrow-tag">
            Species
          </span>
          <h2 className="mt-3 font-sans font-bold text-2xl leading-tight tracking-tight text-balance" style={{ color: 'var(--surface-text)' }}>
            Biological timelines
          </h2>
        </div>
        <div className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
          <Flask size={20} weight="regular" />
        </div>
      </div>
      <p className="text-[13px] mb-5" style={{ color: 'var(--surface-muted)' }}>
        Per-species colonization and fruiting windows, expansion ratios, and
        the biological-efficiency threshold that triggers senescence flags.
      </p>

      <div className="space-y-4 min-w-0">
        {drafts.length === 0 ? (
          <div className="rounded-2xl px-4 py-6 text-center text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--surface-muted)' }}>
            No species configured. Add one in the database to begin.
          </div>
        ) : (
          drafts.map((d) => (
            <SpeciesCard
              key={d.id}
              draft={d}
              status={statuses[d.id] ?? 'idle'}
              error={errors[d.id] ?? null}
              onChange={(patch) => updateOne(d.id, patch)}
              onSave={() => onSave(d)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function SpeciesCard({
  draft,
  status,
  error,
  onChange,
  onSave,
}: {
  draft: SpeciesDraft
  status: SaveStatus
  error: string | null
  onChange: (patch: Partial<SpeciesDraft>) => void
  onSave: () => void
}) {
  return (
    <div className="rounded-2xl p-3 md:p-5 min-w-0 overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-start justify-between gap-3 mb-3 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="font-sans font-semibold text-xl leading-tight break-words text-balance" style={{ color: 'var(--surface-text)' }}>
            {draft.common_name}
          </div>
          <div className="text-[11px] font-mono uppercase tracking-eyebrow mt-0.5" style={{ color: 'var(--bio-green)' }}>
            Profile · versioned
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 min-w-0">
        <RangeField
          label="LC → Gen 1"
          min={draft.lc_to_gen1_days_min}
          max={draft.lc_to_gen1_days_max}
          onChange={(min, max) =>
            onChange({
              lc_to_gen1_days_min: min,
              lc_to_gen1_days_max: max,
            })
          }
        />
        <RangeField
          label="Gen 2 colonize"
          min={draft.gen2_colonization_days_min}
          max={draft.gen2_colonization_days_max}
          onChange={(min, max) =>
            onChange({
              gen2_colonization_days_min: min,
              gen2_colonization_days_max: max,
            })
          }
        />
        <RangeField
          label="Bulk colonize"
          min={draft.bulk_colonization_days_min}
          max={draft.bulk_colonization_days_max}
          onChange={(min, max) =>
            onChange({
              bulk_colonization_days_min: min,
              bulk_colonization_days_max: max,
            })
          }
        />
        <RangeField
          label="Fruiting"
          min={draft.fruiting_days_min}
          max={draft.fruiting_days_max}
          onChange={(min, max) =>
            onChange({
              fruiting_days_min: min,
              fruiting_days_max: max,
            })
          }
        />
        <NumberField
          label="Gen1→Gen2 ratio"
          value={draft.gen1_to_gen2_ratio}
          onChange={(v) => onChange({ gen1_to_gen2_ratio: v })}
          min={2}
          max={30}
          step={1}
          suffix="×"
        />
        <NumberField
          label="G2 → bulk spawn"
          value={draft.gen2_to_bulk_spawn_pct}
          onChange={(v) => onChange({ gen2_to_bulk_spawn_pct: v })}
          min={0.05}
          max={0.5}
          step={0.01}
          suffix=""
          format={(n) => `${Math.round(n * 100)}%`}
        />
        <NumberField
          label="Target BE"
          value={draft.target_biological_efficiency}
          onChange={(v) => onChange({ target_biological_efficiency: v })}
          min={0.1}
          max={1.5}
          step={0.01}
          format={(n) => `${Math.round(n * 100)}%`}
        />
        <NumberField
          label="Senescence tol"
          value={draft.senescence_threshold_pct}
          onChange={(v) => onChange({ senescence_threshold_pct: v })}
          min={0.05}
          max={0.5}
          step={0.01}
          format={(n) => `${Math.round(n * 100)}%`}
        />
        <NumberField
          label="Max gens"
          value={draft.max_generations}
          onChange={(v) => onChange({ max_generations: v })}
          min={2}
          max={20}
          step={1}
        />
        <NumberField
          label="Spore clone freq"
          hint="Every Nth fruiting"
          value={draft.spore_clone_freq}
          onChange={(v) => onChange({ spore_clone_freq: v })}
          min={1}
          max={10}
          step={1}
        />
        <NumberField
          label="LC injection"
          value={Number(
            (
              (draft as unknown as { lc_injection_volume_ml?: number })
                .lc_injection_volume_ml ?? 10
            ),
          )}
          onChange={() => {
            /* read-only mirror — surface only */
          }}
          suffix="mL"
          disabled
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 min-w-0">
        <div className="text-[11px] font-mono truncate" style={{ color: 'var(--surface-muted)' }}>
          PUT /api/settings/species/{draft.id}/profile
        </div>
        <SaveButton
          status={status}
          dirty={true}
          disabled={status === 'saving'}
          onClick={onSave}
          label="Save profile"
        />
      </div>
      {error && (
        <div className="mt-2 text-[12px] font-mono break-words" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  format,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  format?: (n: number) => string
}) {
  return (
    <label className="block min-w-0">
      <div className="flex items-baseline justify-between mb-1 gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-eyebrow font-medium truncate" style={{ color: 'var(--surface-muted)' }}>
          {label}
        </span>
        {hint && (
          <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--surface-muted)', opacity: 0.5 }}>{hint}</span>
        )}
      </div>
      <div
        className={
          'flex items-center gap-1.5 rounded-full px-3 py-2 min-h-[44px] transition-all duration-300 ' +
          (disabled ? 'opacity-50' : '')
        }
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (Number.isFinite(n)) onChange(n)
          }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-mono text-num [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          style={{ color: 'var(--surface-text)' }}
        />
        <span className="text-[12px] font-mono shrink-0" style={{ color: 'var(--bio-green)' }}>
          {format ? format(value) : suffix ?? ''}
        </span>
      </div>
    </label>
  )
}

function RangeField({
  label,
  min,
  max,
  onChange,
}: {
  label: string
  min: number
  max: number
  onChange: (min: number, max: number) => void
}) {
  return (
    <div className="block min-w-0">
      <div className="text-[10px] uppercase tracking-eyebrow font-medium mb-1 truncate" style={{ color: 'var(--surface-muted)' }}>
        {label}
      </div>
      <div className="grid grid-cols-2 gap-1.5 min-w-0">
        <div className="flex items-center gap-1 rounded-full px-2.5 py-1.5 min-h-[44px] min-w-0" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--surface-muted)' }}>min</span>
          <input
            type="number"
            value={Number.isFinite(min) ? min : ''}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              if (Number.isFinite(n)) onChange(n, max)
            }}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-mono text-num [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ color: 'var(--surface-text)' }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-full px-2.5 py-1.5 min-h-[44px] min-w-0" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--surface-muted)' }}>max</span>
          <input
            type="number"
            value={Number.isFinite(max) ? max : ''}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              if (Number.isFinite(n)) onChange(min, n)
            }}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-mono text-num [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ color: 'var(--surface-text)' }}
          />
        </div>
      </div>
    </div>
  )
}

function SaveButton({
  status,
  dirty,
  disabled,
  onClick,
  label = 'Save',
}: {
  status: SaveStatus
  dirty: boolean
  disabled?: boolean
  onClick: () => void
  label?: string
}) {
  const isSaving = status === 'saving'
  const isSaved = status === 'saved'
  const isError = status === 'error'
  const isIdle = !isSaving && !isSaved && !isError

  const style = isSaved || (isIdle && dirty)
    ? { background: 'var(--bio-green)', color: '#080f0a' }
    : isError
    ? { background: 'var(--danger-dim)', color: 'var(--danger)' }
    : { background: 'rgba(255,255,255,0.05)', color: 'var(--surface-muted)', border: '1px solid rgba(255,255,255,0.08)' }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || (!dirty && isIdle) || isSaving}
      className="group min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all duration-300 active:scale-[0.97]"
      style={style}
    >
      {isSaving ? (
        <CircleNotch size={12} weight="regular" className="animate-spin" />
      ) : isSaved ? (
        <Check size={12} weight="regular" />
      ) : null}
      <span>
        {isSaving ? 'Saving…' : isSaved ? 'Saved ✓' : isError ? 'Failed' : label}
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON + ERROR
// ─────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag opacity-60">Settings</span>
        <div className="mt-5 h-9 w-2/3 rounded-2xl skeleton" />
        <div className="mt-3 h-3 w-1/2 rounded-full skeleton" />
      </div>
      <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 min-w-0">
        <div className="md:col-span-5 lab-card">
          <div className="p-4 md:p-5 space-y-3">
            <div className="h-7 w-1/2 rounded-full skeleton" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-12 rounded-full skeleton" />
              ))}
            </div>
          </div>
        </div>
        <div className="md:col-span-7 lab-card">
          <div className="p-4 md:p-5 space-y-4">
            <div className="h-7 w-1/2 rounded-full skeleton" />
            <div className="h-40 rounded-2xl skeleton" />
            <div className="h-40 rounded-2xl skeleton" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const [showUrlModal, setShowUrlModal] = useState(false)

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag">Settings</span>
        <h1 className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-5xl leading-tight tracking-tight text-balance break-words" style={{ color: 'var(--surface-text)' }}>
          Settings unreachable
        </h1>
      </div>
      <div className="mt-8">
        <div className="lab-card p-5 md:p-6">
          <div className="flex items-start gap-3 min-w-0 mb-5">
            <Warning size={22} weight="regular" className="text-warn shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[15px] leading-relaxed break-words" style={{ color: 'var(--surface-text)' }}>
                {message}
              </p>
              <p className="mt-1 text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
                GET /api/settings
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="btn-primary min-h-[44px] group"
            >
              <ArrowClockwise
                size={16}
                weight="regular"
                className="transition-transform duration-300 group-hover:rotate-[60deg]"
              />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => setShowUrlModal(true)}
              className="btn-ghost min-h-[44px]"
            >
              <WifiHigh size={16} weight="regular" />
              <span>Change Server URL</span>
            </button>
          </div>
        </div>
      </div>
      {showUrlModal && <ServerUrlModal onClose={() => setShowUrlModal(false)} />}
    </div>
  )
}
