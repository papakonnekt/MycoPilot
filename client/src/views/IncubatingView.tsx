// =============================================================
// Myco Lab — Incubating (Step 3)
//
// Mobile-overhaul changes:
//  - H1 down to text-4xl/6xl.
//  - Species name in BatchCard no longer `truncate`s; it wraps
//    with break-words and the right-side meta column shrinks
//    to fit.
//  - Touch targets (Move/Open batch buttons) get min-h-[44px].
//  - The floating top bar uses safe-area-inset-top for its
//    sticky position.
//  - All flex parents that hold text columns have min-w-0.
//  - Section spacing drops from space-y-9 → space-y-6 on mobile.
//
// Data flow:
//   1. GET /api/batches → BatchRow[] (snake_case from SQLite).
//   2. Filter: anything NOT terminal (SPENT, CONTAMINATED, HARVESTED,
//      ARCHIVED).
//   3. Sort: overdue first.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion'
import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  WifiSlash,
} from 'phosphor-react'

import {
  ApiError,
  getBatches,
  type BatchRow,
  type SpeciesRow,
  type LineageRow,
} from '../lib/api'
import { HelpTooltip } from '../components/HelpTooltip'
import { ServerUrlModal } from '../components/ServerUrlModal'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: BatchRow[] }

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'SPENT',
  'CONTAMINATED',
  'HARVESTED',
  'ARCHIVED',
])

const COLONIZING_STAGES: ReadonlySet<string> = new Set([
  'INCUBATING',
  'COLONIZING',
  'SPAWN_RUN',
  'INOCULATED',
  'INOCULATION',
])

function deriveProgress(row: BatchRow): {
  pct: number
  target: string | null
  started: string | null
  isOverdue: boolean
} {
  const started = row.colonization_start ?? null
  const target =
    (COLONIZING_STAGES.has(row.stage ?? '')
      ? row.colonization_target
      : row.fruiting_target_end) ?? null

  const rawPct = (row as unknown as { pct_complete?: number | string })
    .pct_complete
  let pct: number
  if (rawPct != null && rawPct !== '') {
    const n = typeof rawPct === 'string' ? parseFloat(rawPct) : rawPct
    pct = Number.isFinite(n) ? n : 0
  } else {
    if (started && target) {
      const s = Date.parse(started)
      const t = Date.parse(target)
      const n = Date.now()
      if (Number.isFinite(s) && Number.isFinite(t) && t > s) {
        pct = Math.max(0, Math.min(100, ((n - s) / (t - s)) * 100))
      } else {
        pct = 0
      }
    } else {
      pct = 0
    }
  }

  let isOverdue = false
  if (target) {
    const t = Date.parse(target)
    if (Number.isFinite(t) && Date.now() > t && pct < 100) isOverdue = true
  }

  return {
    pct: Math.max(0, Math.min(100, pct)),
    target,
    started,
    isOverdue,
  }
}

function humanizeStage(stage: string | undefined | null): string {
  const s = (stage ?? '').toUpperCase()
  if (!s) return 'Active'
  const map: Record<string, string> = {
    INCUBATING: 'Colonizing',
    COLONIZING: 'Colonizing',
    SPAWN_RUN: 'Spawn Run',
    INOCULATED: 'Inoculated',
    INOCULATION: 'Inoculation',
    FRUITING: 'Fruiting',
    PINNING: 'Pinning',
    FRUIT_READY: 'Fruit Ready',
    HARVESTED: 'Harvested',
    SPENT: 'Spent',
    CONTAMINATED: 'Contaminated',
    DORMANT: 'Dormant',
    STORAGE: 'Storage',
  }
  return map[s] ?? s.charAt(0) + s.slice(1).toLowerCase()
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const datePart = iso.split(' ')[0] ?? iso
  const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return '—'
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const datePart = iso.split(' ')[0] ?? iso
  const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return null
  const start = new Date(y, m - 1, d).getTime()
  if (!Number.isFinite(start)) return null
  const days = Math.floor((Date.now() - start) / 86400000)
  return days >= 0 ? days : 0
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null

export default function IncubatingView() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  const [isModalOpen, setIsModalOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (loadInFlight) return loadInFlight
    setState({ kind: 'loading' })
    const work = (async () => {
      try {
        const rows = await getBatches()
        setState({ kind: 'ready', rows })
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Could not reach the incubator.'
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

  if (state.kind === 'loading') return <IncubatingSkeleton />
  if (state.kind === 'error') {
    return <IncubatingError message={state.message} onRetry={load} />
  }

  return (
    <>
      <IncubatingReady
        key={state.rows.length + ':' + (state.rows[0]?.id ?? 'empty')}
        rows={state.rows}
        onReload={(action) => {
          if (action === 'open-modal') setIsModalOpen(true)
          else load()
        }}
      />
      {isModalOpen && (
        <NewBatchModal
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

function IncubatingReady({
  rows,
  onReload,
}: {
  rows: BatchRow[]
  onReload: (action?: string) => void
}) {
  const active = useMemo(() => {
    const filtered = rows.filter((b) => {
      const status = (b.status ?? '').toUpperCase()
      if (TERMINAL_STATUSES.has(status)) return false
      const ic = (b as unknown as { is_contaminated?: number | boolean })
        .is_contaminated
      if (ic === 1 || ic === true) return false
      return true
    })

    const scored = filtered.map((b) => {
      const p = deriveProgress(b)
      return { row: b, ...p }
    })

    scored.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
      if (a.isOverdue && b.isOverdue) return b.pct - a.pct
      const at = a.target ? Date.parse(a.target) : Infinity
      const bt = b.target ? Date.parse(b.target) : Infinity
      if (at !== bt) return at - bt
      const as = a.started ? Date.parse(a.started) : 0
      const bs = b.started ? Date.parse(b.started) : 0
      return bs - as
    })

    return scored
  }, [rows])

  const overdueCount = active.filter((a) => a.isOverdue).length
  const meanPct = active.length
    ? active.reduce((s, a) => s + a.pct, 0) / active.length
    : 0

  return (
    <div className="relative">
      <FloatingTopBar
        activeCount={active.length}
        overdueCount={overdueCount}
        meanPct={meanPct}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto w-full max-w-2xl min-w-0 px-1 pt-2 pb-6"
      >
        {/* Header */}
        <div className="pt-2 min-w-0">
          <div className="flex items-center justify-between min-w-0 mb-4">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <span className="eyebrow-tag">Incubating</span>
              <span
                className="text-[10px] uppercase tracking-eyebrow"
                style={{ color: 'var(--surface-muted)' }}
              >
                Step 3 · Colonization Watch
              </span>
            </div>
            <button
              onClick={() => onReload('open-modal')}
              className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-full font-semibold text-sm transition-transform duration-200 active:scale-95"
              style={{ background: 'var(--bio-green)', color: 'var(--surface-900)' }}
            >
              + New Batch
            </button>
          </div>
          <h1
            className="font-sans font-bold text-4xl md:text-6xl leading-[0.95] tracking-tight text-balance break-words"
            style={{ color: 'var(--surface-text)' }}
          >
            Active batches.
          </h1>
          <p
            className="mt-3 max-w-md text-[15px] leading-relaxed"
            style={{ color: 'var(--surface-muted)' }}
          >
            Overdue first, then on-track by closest target. A red bar means
            it's time to move the batch forward.
          </p>
        </div>

        {/* List */}
        {active.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-6 md:mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <AnimatePresence initial={false}>
              {active.map((b, i) => (
                <BatchCard
                  key={b.row.id}
                  row={b.row}
                  pct={b.pct}
                  target={b.target}
                  started={b.started}
                  isOverdue={b.isOverdue}
                  hero={i === 0}
                  entryDelayMs={Math.min(i * 80, 480)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Footnote */}
        <div
          className="mt-10 md:mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow"
          style={{ color: 'var(--surface-muted)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          <span>End of bench</span>
        </div>

        <button
          type="button"
          onClick={onReload}
          aria-label="Refresh"
          className="sr-only"
        />
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// FLOATING TOP BAR
// ─────────────────────────────────────────────────────────────

function FloatingTopBar({
  activeCount,
  overdueCount,
  meanPct,
}: {
  activeCount: number
  overdueCount: number
  meanPct: number
}) {
  const reduceMotion = useReducedMotion()
  const meanWidth = useMotionValue(0)
  const widthPct = useTransform(meanWidth, (v) => `${Math.round(v)}%`)

  useEffect(() => {
    if (reduceMotion) {
      meanWidth.set(meanPct)
      return
    }
    const controls = animate(meanWidth, meanPct, {
      duration: 1.2,
      ease: [0.32, 0.72, 0, 1],
    })
    return () => controls.stop()
  }, [meanPct, meanWidth, reduceMotion])

  const aggregateColor =
    overdueCount > 0
      ? '#B23A2A'
      : meanPct >= 100
      ? '#0A0A0A'
      : '#1F3D2B'

  return (
    <div
      className="sticky z-30 mx-3 md:mx-auto md:max-w-2xl"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
    >
      <div className="lab-card">
        <div className="flex h-14 items-center justify-between gap-3 px-4 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={'h-1.5 w-1.5 rounded-full shrink-0 '}
              style={{ background: overdueCount > 0 ? '#B23A2A' : 'var(--bio-green)' }}
            />
            <span
              className="font-sans font-semibold text-[17px] leading-none truncate"
              style={{ color: 'var(--surface-text)' }}
            >
              Incubating
            </span>
            <span
              className="font-mono text-[11px] uppercase tracking-eyebrow text-num whitespace-nowrap"
              style={{ color: 'var(--surface-muted)' }}
            >
              {String(activeCount).padStart(2, '0')}
              {overdueCount > 0 && (
                <span className="ml-2 text-[#B23A2A]">
                  · {overdueCount} over
                </span>
              )}
            </span>
          </div>
          <div
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-eyebrow shrink-0 whitespace-nowrap"
            style={{ color: 'var(--surface-muted)' }}
          >
            <span className="text-num">
              MEAN {Math.round(meanPct).toString().padStart(2, '0')}%
            </span>
            <HelpTooltip
              title="Mean Colonization"
              text="The average progress of all currently incubating batches based on their expected colonization timeframes."
            />
          </div>
        </div>
        <div className="h-px w-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div
            style={{ width: widthPct, backgroundColor: aggregateColor }}
            className="h-full"
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// BATCH CARD
// ─────────────────────────────────────────────────────────────

interface BatchCardProps {
  row: BatchRow
  pct: number
  target: string | null
  started: string | null
  isOverdue: boolean
  hero: boolean
  entryDelayMs: number
}

function BatchCard({
  row,
  pct,
  target,
  started,
  isOverdue,
  hero,
  entryDelayMs,
}: BatchCardProps) {
  const reduceMotion = useReducedMotion()

  const widthMV = useMotionValue(0)
  const widthPct = useTransform(widthMV, (v) => `${v}%`)

  useEffect(() => {
    if (reduceMotion) {
      widthMV.set(pct)
      return
    }
    const controls = animate(widthMV, pct, {
      duration: 1.2,
      ease: [0.32, 0.72, 0, 1],
    })
    return () => controls.stop()
  }, [pct, widthMV, reduceMotion])

  const species = row.species_name ?? 'Unknown species'
  const stage = humanizeStage(row.stage)
  const days = daysSince(started)
  const targetStr = formatDateShort(target)
  const startedStr = formatDateShort(started)
  const isComplete = pct >= 100

  const fillColor = isOverdue
    ? '#B23A2A'
    : isComplete
    ? '#0A0A0A'
    : '#1F3D2B'

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, y: -8, scale: 0.98 }
      }
      transition={{
        duration: 0.5,
        ease: [0.32, 0.72, 0, 1],
        delay: entryDelayMs / 1000,
      }}
      className={hero ? 'md:col-span-2' : ''}
    >
      <div
        className={
          'relative lab-card ' +
          (isOverdue ? 'ring-2 ring-[#B23A2A]/30' : '')
        }
      >
        {isOverdue && (
          <div
            aria-hidden
            className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[#B23A2A] z-10"
          />
        )}
        <div className="p-4 md:p-6 min-h-[140px] relative">
          {/* Top row: eyebrow + species + meta */}
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <span
                className={
                  'eyebrow-tag ' +
                  (isOverdue ? '!bg-[#B23A2A]/10 !text-[#B23A2A]' : '')
                }
              >
                {stage}
                <HelpTooltip
                  title="Stage"
                  text="The current phase of this batch: Colonizing (mycelium spreading through substrate), Spawn Run, Fruiting (pins forming), etc."
                />
              </span>
              <h3
                className="mt-2 font-sans font-bold text-xl md:text-3xl leading-[1.1] tracking-tight break-words text-balance"
                style={{ color: 'var(--surface-text)' }}
              >
                {species}
              </h3>
            </div>
            <div
              className="shrink-0 text-right font-mono text-[11px] leading-tight min-w-0"
              style={{ color: 'var(--surface-muted)' }}
            >
              <div className="whitespace-nowrap">
                <span
                  className="uppercase tracking-eyebrow"
                  style={{ color: 'var(--surface-muted)' }}
                >
                  Started
                </span>{' '}
                <span className="text-num">{startedStr}</span>
              </div>
              <div className="mt-0.5 whitespace-nowrap">
                <span
                  className="uppercase tracking-eyebrow"
                  style={{ color: 'var(--surface-muted)' }}
                >
                  Days in
                </span>{' '}
                <span className="text-num">{days != null ? String(days).padStart(2, '0') : '—'}</span>
              </div>
            </div>
          </div>

          {/* Progress section */}
          <div className="mt-4 md:mt-5 min-w-0">
            <div
              className="flex items-center justify-between text-[10px] uppercase tracking-eyebrow font-mono"
              style={{ color: 'var(--surface-muted)' }}
            >
              <span>Day 0</span>
              <span className="flex items-center gap-1">
                Target
                <HelpTooltip
                  title="Colonization Target"
                  text="The expected date when this batch completes its current phase. Calculated from start date plus species-specific typical duration."
                />
              </span>
            </div>

            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <motion.div
                style={{
                  width: widthPct,
                  backgroundColor: fillColor,
                  boxShadow: isComplete
                    ? 'inset 0 1px 0 rgba(255,255,255,0.15)'
                    : 'none',
                }}
                className="h-full"
                animate={
                  isOverdue && !reduceMotion
                    ? { opacity: [0.7, 1, 0.7] }
                    : { opacity: 1 }
                }
                transition={
                  isOverdue && !reduceMotion
                    ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.3 }
                }
              />
            </div>

            <div className="mt-3 flex items-baseline gap-3 flex-wrap min-w-0">
              <CountUpPct value={pct} isOverdue={isOverdue} />
              <span
                className="font-mono text-[10px] uppercase tracking-eyebrow break-words"
                style={{ color: 'var(--surface-muted)' }}
              >
                {isComplete ? 'Complete' : isOverdue ? 'Overdue' : 'In progress'}
                {' · '}
                <span className="text-num">{targetStr}</span>
              </span>
            </div>
          </div>

          {/* Actions row */}
          <div
            className="mt-4 md:mt-5 pt-3 md:pt-4 flex items-center justify-between gap-2 min-w-0"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            {isOverdue ? (
              <button
                type="button"
                className="group min-h-[44px] inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium text-[#B23A2A] transition-all duration-450 ease-fluid"
                style={{ border: '1px solid rgba(178,58,42,0.3)' }}
                aria-label={`Move ${species} to next phase`}
                onClick={(e) => e.preventDefault()}
              >
                <span>Move to next phase</span>
                <ArrowRight
                  size={14}
                  weight="regular"
                  className="transition-transform duration-450 ease-fluid group-hover:translate-x-0.5"
                />
              </button>
            ) : (
              <button
                type="button"
                className="group min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium transition-colors duration-450 ease-fluid"
                style={{ color: 'var(--surface-muted)' }}
                onClick={(e) => e.preventDefault()}
                aria-label={`Open ${species}`}
              >
                <span>Open batch</span>
                <ArrowUpRight
                  size={14}
                  weight="regular"
                  className="transition-transform duration-450 ease-fluid group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </button>
            )}
            <span
              className="font-mono text-[10px] uppercase tracking-eyebrow truncate ml-2"
              style={{ color: 'var(--surface-muted)' }}
            >
              {row.batch_id ?? `#${row.id}`}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// COUNT-UP PERCENT
// ─────────────────────────────────────────────────────────────

function CountUpPct({
  value,
  isOverdue,
}: {
  value: number
  isOverdue: boolean
}) {
  const reduceMotion = useReducedMotion()
  const mv = useMotionValue(0)
  const rounded = useTransform(mv, (v) => Math.round(v))
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const unsub = rounded.on('change', (v) => setDisplay(v))
    return unsub
  }, [rounded])

  useEffect(() => {
    if (reduceMotion) {
      mv.set(value)
      return
    }
    const controls = animate(mv, value, {
      duration: 1.1,
      ease: [0.32, 0.72, 0, 1],
    })
    return () => controls.stop()
  }, [value, mv, reduceMotion])

  return (
    <span
      className="font-sans font-bold text-2xl md:text-3xl leading-none text-num shrink-0"
      style={{ color: isOverdue ? '#B23A2A' : 'var(--surface-text)' }}
    >
      {display}
      <span style={{ color: 'var(--surface-muted)' }}>%</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────

function IncubatingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-1 pt-2 pb-6">
      <div
        className="sticky z-30 mb-4 mx-3 md:mx-auto md:max-w-2xl"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
      >
        <div className="lab-card">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <span className="h-3 w-20 rounded-full skeleton" />
            </div>
            <div className="h-3 w-16 rounded-full skeleton" />
          </div>
          <div className="h-px w-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </div>
      </div>

      <div>
        <span className="eyebrow-tag opacity-60">Incubating</span>
        <div className="mt-5 h-9 w-2/3 rounded-2xl skeleton" />
        <div className="mt-3 h-3 w-1/2 rounded-full skeleton" />
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <SkeletonBatchCard hero />
        <SkeletonBatchCard />
        <SkeletonBatchCard />
        <SkeletonBatchCard />
      </div>
    </div>
  )
}

function SkeletonBatchCard({ hero = false }: { hero?: boolean }) {
  return (
    <div className={hero ? 'md:col-span-2' : ''}>
      <div className="lab-card">
        <div className="p-4 md:p-6 min-h-[140px]">
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-2.5 w-16 rounded-full skeleton" />
              <div className="h-6 w-3/4 rounded-full skeleton" />
            </div>
            <div className="space-y-1 shrink-0">
              <div className="h-2 w-16 rounded-full skeleton" />
              <div className="h-2 w-12 rounded-full skeleton" />
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <div className="flex justify-between">
              <div className="h-2 w-8 rounded-full skeleton" />
              <div className="h-2 w-10 rounded-full skeleton" />
            </div>
            <div className="h-1.5 w-full rounded-full skeleton" />
            <div className="h-7 w-24 rounded-full skeleton mt-3" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ERROR STATE
// ─────────────────────────────────────────────────────────────

function IncubatingError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const [showUrlModal, setShowUrlModal] = useState(false)
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-1 pt-2 pb-6">
      <div className="pt-2">
        <span className="eyebrow-tag">Incubating</span>
        <h1
          className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-6xl leading-[0.95] tracking-tight text-balance break-words"
          style={{ color: 'var(--surface-text)' }}
        >
          Incubator unreachable
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
                GET /api/batches
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
// EMPTY STATE
// ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      className="mt-10 md:mt-12"
    >
      <div className="lab-card">
        <div className="px-6 py-12 md:py-14 text-center">
          <SporeGlyph />
          <h2
            className="mt-5 font-sans font-bold text-3xl md:text-5xl leading-[0.95] tracking-tight text-balance"
            style={{ color: 'var(--surface-text)' }}
          >
            No active batches.
          </h2>
          <p
            className="mt-3 text-[14px] max-w-sm mx-auto"
            style={{ color: 'var(--surface-muted)' }}
          >
            Nothing colonizing, fruiting, or in spawn run. The bench is clear
            — start a new PC run to begin.
          </p>
        </div>
      </div>
    </motion.div>
  )
}

function SporeGlyph() {
  return (
    <div
      className="mx-auto h-12 w-12 rounded-full flex items-center justify-center"
      style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="14" cy="14" r="2" fill="var(--bio-green)" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const angle = (i / 8) * Math.PI * 2
          const x = 14 + Math.cos(angle) * 7
          const y = 14 + Math.sin(angle) * 7
          return <circle key={i} cx={x} cy={y} r="1" fill="var(--bio-green)" opacity="0.55" />
        })}
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// NEW BATCH MODAL
// ─────────────────────────────────────────────────────────────

function NewBatchModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [speciesList, setSpeciesList] = useState<SpeciesRow[]>([])
  const [lineages, setLineages] = useState<LineageRow[]>([])
  const [speciesId, setSpeciesId] = useState<number | ''>('')
  const [lineageId, setLineageId] = useState<number | ''>('')
  const [stage, setStage] = useState('GEN1_GRAIN')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    import('../lib/api').then(({ getSpecies }) => {
      getSpecies().then((data) => {
        setSpeciesList(data)
        if (data.length > 0) setSpeciesId(data[0].id)
      }).catch(err => console.error(err))
    })
  }, [])

  useEffect(() => {
    if (!speciesId) {
      setLineages([])
      return
    }
    import('../lib/api').then(({ getLineagesForSpecies }) => {
      getLineagesForSpecies(Number(speciesId)).then((data) => {
        setLineages(data)
        if (data.length > 0) setLineageId(data[0].id)
        else setLineageId('')
      }).catch(err => console.error(err))
    })
  }, [speciesId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!speciesId) return
    setIsSubmitting(true)
    setError(null)
    try {
      const { createBatch } = await import('../lib/api')
      await createBatch({
        species_id: Number(speciesId),
        lineage_id: lineageId ? Number(lineageId) : null,
        stage,
        container_type: stage.includes('GRAIN') ? 'JAR_QUART' : 'BAG_5LB',
        substrate_type: stage.includes('GRAIN') ? 'MILLET' : 'MASTERS_MIX',
      })
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to create batch')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade_in">
      <div className="w-full max-w-md bg-surface-900 border border-surface-border rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-surface-border">
          <h2 className="font-semibold text-lg" style={{ color: 'var(--surface-text)' }}>New Batch</h2>
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
              onChange={(e) => setSpeciesId(Number(e.target.value) || '')}
              required
            >
              {speciesList.map(s => (
                <option key={s.id} value={s.id}>{s.common_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Lineage (Optional)</label>
            <select
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors"
              value={lineageId}
              onChange={(e) => setLineageId(Number(e.target.value) || '')}
            >
              <option value="">None</option>
              {lineages.map(l => (
                <option key={l.id} value={l.id}>{l.lineage_code} (Gen {l.generation_number})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Stage</label>
            <select
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              required
            >
              <option value="GEN1_GRAIN">Gen 1 Grain</option>
              <option value="GEN2_GRAIN">Gen 2 Grain</option>
              <option value="BULK_BLOCK">Bulk Block</option>
              <option value="FRUITING">Fruiting</option>
            </select>
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
              disabled={isSubmitting || !speciesId}
              className="flex-1 py-2.5 rounded-full font-semibold text-sm bg-bio-green text-surface-900 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Batch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
