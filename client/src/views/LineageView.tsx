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
    />
  )
}

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────

function LineageReady({
  species,
  lineagesBySpecies,
  batches,
}: {
  species: SpeciesRow[]
  lineagesBySpecies: Record<number, LineageRow[]>
  batches: BatchRow[]
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
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="eyebrow-tag">Lineage</span>
            <span className="text-[10px] uppercase tracking-eyebrow text-ink/40">
              Step 4 · Genetic Tracking
            </span>
          </div>
          <h1 className="mt-4 md:mt-5 font-serif text-4xl md:text-6xl leading-[0.95] tracking-tight text-ink text-balance break-words">
            Family trees.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-graphite-500">
            Every strain has a code, a generation count, and a 90-day
            biological-efficiency average. Watch for the brick-out flags — those
            lineages are due for a spore refresh.
          </p>
        </div>

        {/* Stat row */}
        <div className="mt-6 md:mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Lineages tracked"
            value={String(totalLineages).padStart(2, '0')}
            icon={<GitBranch size={16} weight="regular" />}
          />
          <StatTile
            label="Senescent"
            value={String(totalFlagged).padStart(2, '0')}
            tone={totalFlagged > 0 ? 'brick' : 'ink'}
          />
          <StatTile
            label="Active batches"
            value={String(totalBatches).padStart(2, '0')}
          />
          <StatTile
            label="Species"
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
            <div className="bezel-shell">
              <div className="bezel-core p-6 text-center text-[14px] text-graphite-500">
                No species configured.
              </div>
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

        <div className="mt-10 md:mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow text-ink/40">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-700" />
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
    <div className="bezel-shell">
      <div
        className={
          'bezel-core p-4 md:p-6 ' +
          (flagged.length > 0 ? 'ring-2 ring-[#B23A2A]/20' : '')
        }
      >
        <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
          <div className="min-w-0 flex-1">
            <span className="eyebrow-tag !bg-[#B23A2A]/10 !text-[#B23A2A]">
              Senescence risk
            </span>
            <h2 className="mt-3 font-serif text-2xl md:text-3xl leading-[1.05] tracking-tight text-ink text-balance">
              {flagged.length === 0
                ? 'No flag — all lineages healthy.'
                : `${flagged.length} lineage${flagged.length === 1 ? '' : 's'} below threshold`}
            </h2>
          </div>
          <div className="shrink-0 h-10 w-10 rounded-full bg-[#B23A2A]/10 text-[#B23A2A] flex items-center justify-center">
            <Warning size={20} weight="regular" />
          </div>
        </div>
        <p className="text-[13px] text-graphite-500 mt-1 mb-4">
          Lineages whose 90-day average biological efficiency has dropped below{' '}
          the species threshold.
        </p>

        {flagged.length === 0 ? (
          <div className="rounded-2xl bg-moss-700/[0.06] ring-1 ring-moss-700/15 px-4 py-4 text-[13px] text-ink/70 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-moss-700" />
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
      <div className="rounded-2xl ring-1 ring-[#B23A2A]/25 bg-[#B23A2A]/[0.04] p-3.5 min-w-0">
        <div className="flex items-baseline justify-between gap-3 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink text-[15px] leading-tight break-words">
              {flag.speciesName}
            </div>
            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-ink/50 mt-0.5 break-all">
              {flag.lineage.lineage_code}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-serif text-xl md:text-2xl leading-none text-num text-[#B23A2A]">
              {flag.be90d != null ? pct(flag.be90d) : '—'}
            </div>
            <div className="text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono mt-1">
              90-day BE
            </div>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-[#B23A2A]/15 flex items-center justify-between text-[11px] text-ink/60 gap-2 min-w-0">
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
      <div className="bezel-shell">
        <div className="bezel-core p-4 md:p-6">
          <div className="flex items-start justify-between gap-3 mb-4 min-w-0">
            <div className="min-w-0 flex-1">
              <span className="eyebrow-tag">
                {view.species.common_name}
              </span>
              <h2 className="mt-3 font-serif text-2xl md:text-3xl leading-[1.05] tracking-tight text-ink break-words text-balance">
                {view.lineages.length} lineage
                {view.lineages.length === 1 ? '' : 's'}
              </h2>
              <p className="text-[13px] text-graphite-500 mt-1">
                Target BE {pct(targetBe)} · threshold{' '}
                {pct(minAcceptable)} ({(senescPct * 100).toFixed(0)}% below
                target)
              </p>
            </div>
            <div className="shrink-0 h-10 w-10 rounded-full bg-moss-700/10 text-moss-700 flex items-center justify-center">
              <TreeStructure size={20} weight="regular" />
            </div>
          </div>

          {view.lineages.length === 0 ? (
            <div className="rounded-2xl bg-black/[0.025] ring-1 ring-black/5 px-4 py-6 text-center text-[13px] text-graphite-500">
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
    <div className="rounded-2xl ring-1 ring-ink/[0.07] bg-paper/40 p-3 min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-eyebrow text-ink/40 font-medium truncate">
            {label}
          </div>
          <div className="text-[11px] text-graphite-500 mt-0.5 truncate">{hint}</div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink/30 text-num shrink-0">
          {String(lineages.length).padStart(2, '0')}
        </span>
      </div>

      <div className="space-y-2 min-h-[60px] min-w-0">
        {lineages.length === 0 ? (
          <div className="rounded-xl bg-black/[0.02] ring-1 ring-black/5 px-3 py-3 text-center text-[11px] text-ink/30">
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
  const accentColor = isFlagged ? '#B23A2A' : '#1F3D2B'
  const currentStage = batches.find((b) =>
    ['INCUBATING', 'COLONIZED', 'FRUITING'].includes(b.status),
  )
  const stageGen = stageToGen(currentStage?.stage)

  const beBarWidth =
    be == null ? 0 : Math.min(100, Math.max(0, (be / Math.max(targetBe, 0.01)) * 100))

  return (
    <div
      className={
        'rounded-xl ring-1 bg-white px-3 py-2.5 min-w-0 ' +
        (isFlagged
          ? 'ring-[#B23A2A]/30 hover:ring-[#B23A2A]/50'
          : 'ring-ink/[0.06] hover:ring-ink/[0.12]')
      }
    >
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-wide_lab text-ink break-all min-w-0">
          {lineage.lineage_code}
        </div>
        {isFlagged && (
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-eyebrow font-medium bg-[#B23A2A]/10 text-[#B23A2A]">
            Senescent
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[10px] text-graphite-500 truncate">
        {originLabel(lineage.origin_type)}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5 min-w-0">
        <span
          className="font-serif text-lg md:text-xl leading-none text-num"
          style={{ color: accentColor }}
        >
          {be != null ? pct(be) : '—'}
        </span>
        <span className="text-[10px] text-ink/40 font-mono">BE</span>
      </div>
      {be != null && (
        <div className="mt-1.5 h-1 rounded-full bg-ink/5 overflow-hidden">
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
        <div className="mt-1.5 text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono break-words">
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
      className={
        'snap-start shrink-0 w-56 rounded-2xl ring-1 p-3 bg-white min-w-0 ' +
        (isFlagged ? 'ring-[#B23A2A]/30' : 'ring-ink/[0.07]')
      }
    >
      <div className="font-mono text-[12px] uppercase tracking-wide_lab text-ink break-all">
        {lineage.lineage_code}
      </div>
      <div className="text-[11px] text-graphite-500 mt-0.5">
        {originLabel(lineage.origin_type)} · gen {lineage.generation_count}
      </div>
      <div className="mt-2 font-serif text-2xl text-num text-ink">
        {be != null ? pct(be) : '—'}
      </div>
      <div className="text-[10px] text-ink/40 font-mono uppercase tracking-eyebrow mt-0.5">
        90-day BE
      </div>
      {batches.length > 0 && (
        <div className="mt-2 text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono whitespace-nowrap">
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
      ? 'text-[#B23A2A]'
      : tone === 'amber'
      ? 'text-amber_lab'
      : 'text-ink'
  return (
    <div className="bezel-shell">
      <div className="bezel-core px-3 md:px-4 py-4">
        <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-eyebrow text-ink/40 font-medium truncate">
            {label}
          </span>
          {icon && <span className="text-ink/30 shrink-0">{icon}</span>}
        </div>
        <div
          className={
            'font-serif text-2xl md:text-4xl leading-none text-num ' + valueColor
          }
        >
          {value}
        </div>
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
          <div key={i} className="bezel-shell">
            <div className="bezel-core px-3 md:px-4 py-4">
              <div className="h-2 w-16 rounded-full skeleton" />
              <div className="mt-3 h-7 w-12 rounded-full skeleton" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 bezel-shell">
        <div className="bezel-core p-5 space-y-3">
          <div className="h-6 w-1/2 rounded-full skeleton" />
          <div className="h-3 w-2/3 rounded-full skeleton" />
          <div className="h-16 w-full rounded-2xl skeleton" />
        </div>
      </div>
      <div className="mt-6 bezel-shell">
        <div className="bezel-core p-5">
          <div className="h-6 w-1/3 rounded-full skeleton mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl skeleton" />
            ))}
          </div>
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
  return (
    <div className="mx-auto w-full max-w-3xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag">Lineage</span>
        <h1 className="mt-4 md:mt-5 font-serif text-4xl md:text-6xl leading-[0.95] tracking-tight text-ink text-balance break-words">
          Lineage unreachable
        </h1>
      </div>
      <div className="mt-8">
        <div className="bezel-shell">
          <div className="bezel-core p-5 md:p-6">
            <div className="flex items-start gap-3 min-w-0">
              <Warning size={22} weight="regular" className="text-amber_lab shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[15px] text-ink leading-relaxed break-words">
                  {message}
                </p>
                <p className="mt-1 text-[12px] text-ink/50 font-mono">
                  GET /api/species · GET /api/species/:id/lineages · GET /api/batches
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 min-h-[44px] group inline-flex items-center gap-2 btn-moss"
            >
              <ArrowClockwise
                size={16}
                weight="regular"
                className="transition-transform duration-450 ease-fluid group-hover:rotate-[60deg]"
              />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
