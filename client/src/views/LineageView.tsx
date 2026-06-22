// =============================================================
// Myco Lab — Lineage (Phase 3 Step 4)
//
// Mobile-overhaul changes:
//  - H1 down to text-4xl/6xl.
//  - Stat row drops to 2 cols on mobile, 4 on md+.
//  - LineageChip and MobileLineageCard give long codes / BE
//    percentages a real wrap path (break-all, break-words) and
//    ensure parent flex rows have min-w-0.
//  - Long species name in the Senescence panel uses break-words
//    so it can wrap below the percent value on narrow screens
//    (was `truncate`).
//  - Touch targets (where present) get min-h-[44px].
//
// Data flow:
//   1. GET /species → SpeciesRow[] (with target_biological_efficiency)
//   2. GET /species/:id/lineages → LineageRow[] (with avg_be_90d)
//   3. (Derived) per-generation location: tracked by joining lineage → batch
//      stage. We use batch.stage from GET /batches to determine which
//      generation column each lineage currently occupies.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  GitBranch,
  TreeStructure,
  Warning,
  WifiSlash,
} from 'phosphor-react'

import {
  ApiError,
  getBatches,
  getLineagesForSpecies,
  getSpecies,
  type BatchRow,
  type LineageRow,
  type SpeciesRow,
} from '../lib/api'
import { HelpTooltip } from '../components/HelpTooltip'
import { ServerUrlModal } from '../components/ServerUrlModal'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; species: SpeciesRow[]; lineagesBySpecies: Record<number, LineageRow[]>; batches: BatchRow[] }

interface SpeciesView {
  species: SpeciesRow
  lineages: LineageRow[]
  flagged: LineageRow[]
  averageBe: number | null
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function originLabel(origin: string): string {
  const map: Record<string, string> = {
    SPORE_PRINT: 'Spore Print',
    CLONE: 'Clone',
    COMMERCIAL_LC: 'Commercial LC',
    AGAR: 'Agar',
  }
  return map[origin] ?? origin
}

function stageToGen(stage: string | undefined | null): number | null {
  const s = (stage ?? '').toUpperCase()
  if (s === 'GEN1_GRAIN') return 1
  if (s === 'GEN2_GRAIN') return 2
  if (s === 'BULK_BLOCK' || s === 'FRUITING') return 3
  return null
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null

export default function LineageView() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    if (loadInFlight) return loadInFlight
    setState({ kind: 'loading' })
    const work = (async () => {
      try {
        const species = await getSpecies()
        const pairs = await Promise.all(
          species.map(async (s) => {
            try {
              const lineages = await getLineagesForSpecies(s.id)
              return [s.id, lineages] as const
            } catch {
              return [s.id, [] as LineageRow[]] as const
            }
          }),
        )
        const lineagesBySpecies: Record<number, LineageRow[]> = {}
        for (const [id, list] of pairs) lineagesBySpecies[id] = list
        const batches = await getBatches()
        setState({
          kind: 'ready',
          species,
          lineagesBySpecies,
          batches,
        })
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Could not load lineage registry.'
        setState({ kind: 'error', message })
      }
    })()
    loadInFlight = work.finally(() => {
      loadInFlight = null
    })
    return loadInFlight
  }, [])

  const [isModalOpen, setIsModalOpen] = useState(false)

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    void loadRef.current()
  }, [])

  if (state.kind === 'loading') return <LineageSkeleton />
  if (state.kind === 'error') {
    return <LineageError message={state.message} onRetry={load} />
  }

  return (
    <>
      <LineageReady
        key={
          state.species.length +
          ':' +
          state.batches.length +
          ':' +
          Object.values(state.lineagesBySpecies).reduce(
            (s, arr) => s + arr.length,
            0,
          )
        }
        species={state.species}
        lineagesBySpecies={state.lineagesBySpecies}
        batches={state.batches}
        onAddLineage={() => setIsModalOpen(true)}
      />
      {isModalOpen && (
        <NewLineageModal 
          species={state.species}
          onClose={() => setIsModalOpen(false)} 
          onSuccess={() => {
            setIsModalOpen(false)
            load()
          }} 
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────

function LineageReady({
  species,
  lineagesBySpecies,
  batches,
  onAddLineage,
}: {
  species: SpeciesRow[]
  lineagesBySpecies: Record<number, LineageRow[]>
  batches: BatchRow[]
  onAddLineage: () => void
}) {
  const reduceMotion = useReducedMotion()

  const batchesByLineage = useMemo(() => {
    const map = new Map<number, BatchRow[]>()
    for (const b of batches) {
      if (b.lineage_id == null) continue
      const list = map.get(b.lineage_id) ?? []
      list.push(b)
      map.set(b.lineage_id, list)
    }
    return map
  }, [batches])

  const views: SpeciesView[] = useMemo(() => {
    return species.map((s) => {
      const lineages = lineagesBySpecies[s.id] ?? []
      const targetBe = num(s.target_biological_efficiency, 0.5)
      const senescPct = num(s.senescence_threshold_pct, 0.2)
      const minAcceptable = targetBe * (1 - senescPct)

      const flagged = lineages.filter((l) => {
        if (l.is_senescent) return true
        const be = l.avg_be_90d
        if (be == null) return false
        return be < minAcceptable
      })

      const allBe = lineages
        .map((l) => l.avg_be_90d)
        .filter((v): v is number => v != null && Number.isFinite(v))
      const averageBe =
        allBe.length > 0 ? allBe.reduce((a, b) => a + b, 0) / allBe.length : null

      return { species: s, lineages, flagged, averageBe }
    })
  }, [species, lineagesBySpecies])

  const totalLineages = views.reduce((s, v) => s + v.lineages.length, 0)
  const totalFlagged = views.reduce((s, v) => s + v.flagged.length, 0)
  const totalBatches = batches.length

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
          <div className="flex items-center justify-between min-w-0 mb-4">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <span className="eyebrow-tag">Lineage</span>
              <span
                className="text-[10px] uppercase tracking-eyebrow"
                style={{ color: 'var(--surface-muted)' }}
              >
                Step 4 · Genetic Tracking
              </span>
            </div>
            <button
              onClick={onAddLineage}
              className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-full font-semibold text-sm transition-transform duration-200 active:scale-95"
              style={{ background: 'var(--bio-green)', color: 'var(--surface-900)' }}
            >
              + New Lineage
            </button>
          </div>
          <h1
            className="font-sans font-bold text-4xl md:text-6xl leading-[0.95] tracking-tight text-balance break-words"
            style={{ color: 'var(--surface-text)' }}
          >
            Family trees.
          </h1>
          <p
            className="mt-3 max-w-xl text-[15px] leading-relaxed"
            style={{ color: 'var(--surface-muted)' }}
          >
            Every strain has a code, a generation count, and a 90-day
            biological-efficiency average. Watch for the brick-out flags — those
            lineages are due for a spore refresh.
          </p>
        </div>

        {/* Stat row */}
        <div className="mt-6 md:mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Lineages tracked
                <HelpTooltip title="Lineages Tracked" text="The total number of unique genetic strains you are actively tracking in the lab." />
              </span>
            }
            value={String(totalLineages).padStart(2, '0')}
            icon={<GitBranch size={16} weight="regular" />}
          />
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Senescent
                <HelpTooltip title="Senescent Lineages" text="Strains that have aged and whose biological efficiency has dropped below the acceptable threshold." />
              </span>
            }
            value={String(totalFlagged).padStart(2, '0')}
            tone={totalFlagged > 0 ? 'brick' : 'ink'}
          />
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Active batches
                <HelpTooltip title="Active Batches" text="The total number of ongoing colonization or fruiting batches connected to these lineages." />
              </span>
            }
            value={String(totalBatches).padStart(2, '0')}
          />
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Species
                <HelpTooltip title="Species Count" text="The total number of species types you currently have configured in your lab settings." />
              </span>
            }
            value={String(species.length).padStart(2, '0')}
          />
        </div>

        {/* Senescence Risk panel */}
        <div className="mt-6 md:mt-8 min-w-0">
          <SenescenceRiskPanel views={views} batchesByLineage={batchesByLineage} />
        </div>

        {/* Per-species lineage views */}
        <div className="mt-6 md:mt-8 space-y-4 md:space-y-6 min-w-0">
          {views.length === 0 ? (
            <div className="lab-card p-6 text-center text-[14px]" style={{ color: 'var(--surface-muted)' }}>
              No species configured.
            </div>
          ) : (
            views.map((v, i) => (
              <SpeciesLineageCard
                key={v.species.id}
                view={v}
                index={i}
                batchesByLineage={batchesByLineage}
              />
            ))
          )}
        </div>

        <div
          className="mt-10 md:mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow"
          style={{ color: 'var(--surface-muted)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          <span>End of lineage registry</span>
        </div>
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SENESCENCE RISK PANEL
// ─────────────────────────────────────────────────────────────

function SenescenceRiskPanel({
  views,
  batchesByLineage,
}: {
  views: SpeciesView[]
  batchesByLineage: Map<number, BatchRow[]>
}) {
  const flagged: Array<{
    lineage: LineageRow
    speciesName: string
    targetBe: number
    be90d: number | null
    batches: BatchRow[]
  }> = []

  for (const v of views) {
    for (const l of v.flagged) {
      flagged.push({
        lineage: l,
        speciesName: v.species.common_name,
        targetBe: num(v.species.target_biological_efficiency, 0.5),
        be90d: l.avg_be_90d ?? null,
        batches: batchesByLineage.get(l.id) ?? [],
      })
    }
  }

  return (
    <div
      className="lab-card p-4 md:p-6"
      style={flagged.length > 0 ? { outline: '2px solid rgba(178,58,42,0.2)' } : {}}
    >
      <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
        <div className="min-w-0 flex-1">
          <span className="eyebrow-tag !bg-[#B23A2A]/10 !text-[#B23A2A]">
            Senescence risk
            <HelpTooltip
              title="Senescence Risk"
              text="Lineages whose 90-day average biological efficiency (BE%) has dropped below the species-specific threshold. These strains should be refreshed from spore or a healthy clone."
            />
          </span>
          <h2
            className="mt-3 font-sans font-bold text-2xl md:text-3xl leading-[1.05] tracking-tight text-balance"
            style={{ color: 'var(--surface-text)' }}
          >
            {flagged.length === 0
              ? 'No flag — all lineages healthy.'
              : `${flagged.length} lineage${flagged.length === 1 ? '' : 's'} below threshold`}
          </h2>
        </div>
        <div className="shrink-0 h-10 w-10 rounded-full bg-[#B23A2A]/10 text-[#B23A2A] flex items-center justify-center">
          <Warning size={20} weight="regular" />
        </div>
      </div>
      <p
        className="text-[13px] mt-1 mb-4"
        style={{ color: 'var(--surface-muted)' }}
      >
        Lineages whose 90-day average biological efficiency has dropped below{' '}
        the species threshold.
      </p>

      {flagged.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-4 text-[13px] flex items-center gap-2"
          style={{
            background: 'var(--bio-green-dim)',
            border: '1px solid rgba(31,61,43,0.3)',
            color: 'var(--surface-muted)',
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          Run a few harvests to populate BE history.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <AnimatePresence initial={false}>
            {flagged.map((f, i) => (
              <FlaggedLineageRow
                key={f.lineage.id}
                flag={f}
                entryDelayMs={Math.min(i * 60, 360)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function FlaggedLineageRow({
  flag,
  entryDelayMs,
}: {
  flag: {
    lineage: LineageRow
    speciesName: string
    targetBe: number
    be90d: number | null
    batches: BatchRow[]
  }
  entryDelayMs: number
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={{
        duration: 0.45,
        ease: [0.32, 0.72, 0, 1],
        delay: entryDelayMs / 1000,
      }}
    >
      <div
        className="rounded-2xl p-3.5 min-w-0"
        style={{
          border: '1px solid rgba(178,58,42,0.25)',
          background: 'rgba(178,58,42,0.04)',
        }}
      >
        <div className="flex items-baseline justify-between gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div
              className="font-medium text-[15px] leading-tight break-words"
              style={{ color: 'var(--surface-text)' }}
            >
              {flag.speciesName}
            </div>
            <div
              className="font-mono text-[11px] uppercase tracking-eyebrow mt-0.5 break-all"
              style={{ color: 'var(--surface-muted)' }}
            >
              {flag.lineage.lineage_code}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-sans font-bold text-xl md:text-2xl leading-none text-num text-[#B23A2A]">
              {flag.be90d != null ? pct(flag.be90d) : '—'}
            </div>
            <div
              className="text-[10px] uppercase tracking-eyebrow font-mono mt-1"
              style={{ color: 'var(--surface-muted)' }}
            >
              90-day BE
              <HelpTooltip
                title="90-Day BE%"
                text="Biological Efficiency: weight of fresh mushrooms harvested ÷ dry weight of substrate used, averaged over the last 90 days. Higher is better; below the threshold means this lineage is underperforming."
              />
            </div>
          </div>
        </div>
        <div
          className="mt-2 pt-2 flex items-center justify-between text-[11px] gap-2 min-w-0"
          style={{
            borderTop: '1px solid rgba(178,58,42,0.15)',
            color: 'var(--surface-muted)',
          }}
        >
          <span className="font-mono uppercase tracking-eyebrow">
            Target {pct(flag.targetBe)}
          </span>
          <span className="font-mono uppercase tracking-eyebrow whitespace-nowrap">
            {flag.batches.length} batch{flag.batches.length === 1 ? '' : 'es'}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// SPECIES LINEAGE CARD
// ─────────────────────────────────────────────────────────────

const GEN_LABELS: Array<{ gen: number; name: string; hint: string }> = [
  { gen: 0, name: 'Gen 0', hint: 'Spore Print' },
  { gen: 1, name: 'Gen 1', hint: 'LC → Grain' },
  { gen: 2, name: 'Gen 2', hint: 'Grain → Grain' },
  { gen: 3, name: 'Gen 3', hint: 'Bulk Block' },
]

function SpeciesLineageCard({
  view,
  index,
  batchesByLineage,
}: {
  view: SpeciesView
  index: number
  batchesByLineage: Map<number, BatchRow[]>
}) {
  const reduceMotion = useReducedMotion()
  const targetBe = num(view.species.target_biological_efficiency, 0.5)
  const senescPct = num(view.species.senescence_threshold_pct, 0.2)
  const minAcceptable = targetBe * (1 - senescPct)

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        ease: [0.32, 0.72, 0, 1],
        delay: Math.min(index * 80, 360) / 1000,
      }}
    >
      <div className="lab-card p-4 md:p-6">
        <div className="flex items-start justify-between gap-3 mb-4 min-w-0">
          <div className="min-w-0 flex-1">
            <span className="eyebrow-tag">
              {view.species.common_name}
            </span>
            <h2
              className="mt-3 font-sans font-bold text-2xl md:text-3xl leading-[1.05] tracking-tight break-words text-balance"
              style={{ color: 'var(--surface-text)' }}
            >
              {view.lineages.length} lineage
              {view.lineages.length === 1 ? '' : 's'}
            </h2>
            <p
              className="text-[13px] mt-1"
              style={{ color: 'var(--surface-muted)' }}
            >
              Target BE {pct(targetBe)} · threshold{' '}
              {pct(minAcceptable)} ({(senescPct * 100).toFixed(0)}% below
              target)
              <HelpTooltip
                title="BE Threshold"
                text="If a lineage's 90-day average BE% drops this far below the species target, it is flagged as senescent and due for a genetic refresh."
              />
            </p>
          </div>
          <div
            className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}
          >
            <TreeStructure size={20} weight="regular" />
          </div>
        </div>

        {view.lineages.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-6 text-center text-[13px]"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--surface-muted)',
            }}
          >
            No lineages registered for this species yet.
          </div>
        ) : (
          <>
            {/* Desktop 4-column grid */}
            <div className="hidden md:grid md:grid-cols-4 gap-3 min-w-0">
              {GEN_LABELS.map((col) => (
                <GenerationColumn
                  key={col.gen}
                  label={col.name}
                  hint={col.hint}
                  lineages={view.lineages.filter(
                    (l) => l.generation_count === col.gen,
                  )}
                  batchesByLineage={batchesByLineage}
                  targetBe={targetBe}
                  minAcceptable={minAcceptable}
                />
              ))}
            </div>

            {/* Mobile: horizontal scrolling chip strip per lineage */}
            <div className="md:hidden -mx-1 px-1">
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                {view.lineages.map((l) => (
                  <MobileLineageCard
                    key={l.id}
                    lineage={l}
                    batches={batchesByLineage.get(l.id) ?? []}
                    minAcceptable={minAcceptable}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}

function GenerationColumn({
  label,
  hint,
  lineages,
  batchesByLineage,
  targetBe,
  minAcceptable,
}: {
  label: string
  hint: string
  lineages: LineageRow[]
  batchesByLineage: Map<number, BatchRow[]>
  targetBe: number
  minAcceptable: number
}) {
  return (
    <div
      className="rounded-2xl p-3 min-w-0"
      style={{
        border: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div
            className="text-[10px] uppercase tracking-eyebrow font-medium truncate"
            style={{ color: 'var(--surface-muted)' }}
          >
            {label}
            <HelpTooltip
              title={label}
              text={`${hint} — this column shows lineages currently at the ${label} propagation stage.`}
            />
          </div>
          <div
            className="text-[11px] mt-0.5 truncate"
            style={{ color: 'var(--surface-muted)' }}
          >
            {hint}
          </div>
        </div>
        <span
          className="font-mono text-[10px] uppercase tracking-eyebrow text-num shrink-0"
          style={{ color: 'var(--surface-muted)' }}
        >
          {String(lineages.length).padStart(2, '0')}
        </span>
      </div>

      <div className="space-y-2 min-h-[60px] min-w-0">
        {lineages.length === 0 ? (
          <div
            className="rounded-xl px-3 py-3 text-center text-[11px]"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'var(--surface-muted)',
            }}
          >
            —
          </div>
        ) : (
          lineages.map((l) => (
            <LineageChip
              key={l.id}
              lineage={l}
              batches={batchesByLineage.get(l.id) ?? []}
              targetBe={targetBe}
              minAcceptable={minAcceptable}
            />
          ))
        )}
      </div>
    </div>
  )
}

function LineageChip({
  lineage,
  batches,
  targetBe,
  minAcceptable,
}: {
  lineage: LineageRow
  batches: BatchRow[]
  targetBe: number
  minAcceptable: number
}) {
  void targetBe
  const be = lineage.avg_be_90d
  const isFlagged =
    lineage.is_senescent || (be != null && be < minAcceptable)
  const accentColor = isFlagged ? '#B23A2A' : 'var(--bio-green)'
  const currentStage = batches.find((b) =>
    ['INCUBATING', 'COLONIZED', 'FRUITING'].includes(b.status),
  )
  const stageGen = stageToGen(currentStage?.stage)

  const beBarWidth =
    be == null ? 0 : Math.min(100, Math.max(0, (be / Math.max(targetBe, 0.01)) * 100))

  return (
    <div
      className="rounded-xl px-3 py-2.5 min-w-0"
      style={{
        border: isFlagged
          ? '1px solid rgba(178,58,42,0.3)'
          : '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <div
          className="font-mono text-[11px] uppercase tracking-wide_lab break-all min-w-0"
          style={{ color: 'var(--surface-text)' }}
        >
          {lineage.lineage_code}
        </div>
        {isFlagged && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-eyebrow font-medium bg-[#B23A2A]/10 text-[#B23A2A]">
            Senescent
          </span>
        )}
      </div>
      <div
        className="mt-0.5 text-[10px] truncate"
        style={{ color: 'var(--surface-muted)' }}
      >
        {originLabel(lineage.origin_type)}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5 min-w-0">
        <span
          className="font-sans font-bold text-lg md:text-xl leading-none text-num"
          style={{ color: accentColor }}
        >
          {be != null ? pct(be) : '—'}
        </span>
        <span
          className="text-[10px] font-mono"
          style={{ color: 'var(--surface-muted)' }}
        >
          BE
        </span>
      </div>
      {be != null && (
        <div
          className="mt-1.5 h-1 rounded-full overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="h-full"
            style={{
              width: `${beBarWidth}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>
      )}
      {currentStage && stageGen != null && (
        <div
          className="mt-1.5 text-[10px] uppercase tracking-eyebrow font-mono break-words"
          style={{ color: 'var(--surface-muted)' }}
        >
          now · {currentStage.species_name ?? 'batch'} · gen {stageGen}
        </div>
      )}
    </div>
  )
}

function MobileLineageCard({
  lineage,
  batches,
  minAcceptable,
}: {
  lineage: LineageRow
  batches: BatchRow[]
  minAcceptable: number
}) {
  const be = lineage.avg_be_90d
  const isFlagged =
    lineage.is_senescent || (be != null && be < minAcceptable)
  return (
    <div
      className="snap-start shrink-0 w-56 rounded-2xl p-3 min-w-0"
      style={{
        border: isFlagged
          ? '1px solid rgba(178,58,42,0.3)'
          : '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <div
        className="font-mono text-[12px] uppercase tracking-wide_lab break-all"
        style={{ color: 'var(--surface-text)' }}
      >
        {lineage.lineage_code}
      </div>
      <div
        className="text-[11px] mt-0.5"
        style={{ color: 'var(--surface-muted)' }}
      >
        {originLabel(lineage.origin_type)} · gen {lineage.generation_count}
      </div>
      <div
        className="mt-2 font-sans font-bold text-2xl text-num"
        style={{ color: 'var(--surface-text)' }}
      >
        {be != null ? pct(be) : '—'}
      </div>
      <div
        className="text-[10px] font-mono uppercase tracking-eyebrow mt-0.5"
        style={{ color: 'var(--surface-muted)' }}
      >
        90-day BE
      </div>
      {batches.length > 0 && (
        <div
          className="mt-2 text-[10px] uppercase tracking-eyebrow font-mono whitespace-nowrap"
          style={{ color: 'var(--surface-muted)' }}
        >
          {batches.length} active batch{batches.length === 1 ? '' : 'es'}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// STAT TILE
// ─────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tone = 'ink',
  icon,
}: {
  label: string
  value: string
  tone?: 'ink' | 'amber' | 'brick'
  icon?: React.ReactNode
}) {
  const valueColor =
    tone === 'brick'
      ? '#B23A2A'
      : tone === 'amber'
      ? 'var(--warn)'
      : 'var(--surface-text)'
  return (
    <div className="lab-card px-3 md:px-4 py-4">
      <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
        <span
          className="text-[10px] uppercase tracking-eyebrow font-medium truncate"
          style={{ color: 'var(--surface-muted)' }}
        >
          {label}
        </span>
        {icon && (
          <span className="shrink-0" style={{ color: 'var(--surface-muted)' }}>
            {icon}
          </span>
        )}
      </div>
      <div
        className="font-sans font-bold text-2xl md:text-4xl leading-none text-num"
        style={{ color: valueColor }}
      >
        {value}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON + ERROR
// ─────────────────────────────────────────────────────────────

function LineageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag opacity-60">Lineage</span>
        <div className="mt-5 h-9 w-2/3 rounded-2xl skeleton" />
      </div>
      <div className="mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="lab-card px-3 md:px-4 py-4">
            <div className="h-2 w-16 rounded-full skeleton" />
            <div className="mt-3 h-7 w-12 rounded-full skeleton" />
          </div>
        ))}
      </div>
      <div className="mt-8 lab-card p-5 space-y-3">
        <div className="h-6 w-1/2 rounded-full skeleton" />
        <div className="h-3 w-2/3 rounded-full skeleton" />
        <div className="h-16 w-full rounded-2xl skeleton" />
      </div>
      <div className="mt-6 lab-card p-5">
        <div className="h-6 w-1/3 rounded-full skeleton mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl skeleton" />
          ))}
        </div>
      </div>
    </div>
  )
}

function LineageError({
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
        <span className="eyebrow-tag">Lineage</span>
        <h1
          className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-6xl leading-[0.95] tracking-tight text-balance break-words"
          style={{ color: 'var(--surface-text)' }}
        >
          Lineage unreachable
        </h1>
      </div>
      <div className="mt-8">
        <div className="lab-card p-5 md:p-6">
          <div className="flex items-start gap-3 min-w-0">
            <WifiSlash
              size={22}
              weight="regular"
              className="shrink-0 mt-0.5"
              style={{ color: 'var(--warn)' }}
            />
            <div className="min-w-0">
              <p
                className="text-[15px] leading-relaxed break-words"
                style={{ color: 'var(--surface-text)' }}
              >
                {message}
              </p>
              <p
                className="mt-1 text-[12px] font-mono"
                style={{ color: 'var(--surface-muted)' }}
              >
                GET /api/species · GET /api/species/:id/lineages · GET /api/batches
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="btn-primary min-h-[44px] group inline-flex items-center gap-2"
            >
              <ArrowClockwise
                size={16}
                weight="regular"
                className="transition-transform duration-450 ease-fluid group-hover:rotate-[60deg]"
              />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => setShowUrlModal(true)}
              className="btn-ghost min-h-[44px] inline-flex items-center gap-2"
            >
              Change Server URL
            </button>
          </div>
        </div>
      </div>
      {showUrlModal && (
        <ServerUrlModal onClose={() => setShowUrlModal(false)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// NEW LINEAGE MODAL
// ─────────────────────────────────────────────────────────────

function NewLineageModal({
  species,
  onClose,
  onSuccess,
}: {
  species: SpeciesRow[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [speciesId, setSpeciesId] = useState(species[0]?.id || '')
  const [lineageCode, setLineageCode] = useState('')
  const [generation, setGeneration] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!speciesId || !lineageCode) return
    setIsSubmitting(true)
    setError(null)
    try {
      const { createLineage } = await import('../lib/api')
      await createLineage(speciesId, {
        lineage_code: lineageCode,
        generation_number: generation,
        is_senescent: false,
      })
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to create lineage')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade_in">
      <div className="w-full max-w-md bg-surface-900 border border-surface-border rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-surface-border">
          <h2 className="font-semibold text-lg" style={{ color: 'var(--surface-text)' }}>New Lineage</h2>
          <button onClick={onClose} className="p-2 text-surface-muted hover:text-surface-text transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-4">
          <div>
            <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Species</label>
            <select
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors"
              value={speciesId}
              onChange={(e) => setSpeciesId(e.target.value)}
              required
            >
              {species.map(s => (
                <option key={s.id} value={s.id}>{s.common_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Lineage Code</label>
            <input
              type="text"
              required
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors font-mono"
              placeholder="e.g. BO-01"
              value={lineageCode}
              onChange={(e) => setLineageCode(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--surface-muted)' }}>
              Generation
              <HelpTooltip title="Generation" text="The current propagation generation for this lineage. Spore prints are Gen 0. LC to Grain is usually Gen 1." />
            </label>
            <input
              type="number"
              min="0"
              required
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors"
              value={generation}
              onChange={(e) => setGeneration(parseInt(e.target.value) || 0)}
            />
          </div>

          {error && <div className="p-3 bg-danger-dim text-danger text-sm rounded-lg">{error}</div>}

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-full font-semibold text-sm bg-surface-800 text-surface-text hover:bg-surface-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !lineageCode || !speciesId}
              className="flex-1 py-2.5 rounded-full font-semibold text-sm bg-bio-green text-surface-900 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Lineage'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
