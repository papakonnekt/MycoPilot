// =============================================================
// Myco Lab — Incubating (Step 3)
//
// Colonization watch. Mobile-first clinical read of every active
// batch — most-overdue at the top, on-track below. Same Double-Bezel
// vocabulary as DailyView, no new tokens, no new easing.
//
// Data flow:
//   1. GET /api/batches → BatchRow[] (snake_case from SQLite).
//   2. Filter: anything NOT terminal (SPENT, CONTAMINATED, HARVESTED,
//      ARCHIVED). All status values from server/src/db/schema.sql are
//      considered "active" except the terminal set.
//   3. Sort: overdue first (most-overdue-on-top), then on-track
//      batches by ascending target date (closest deadline first).
//
// Design decisions:
//   • Sort: overdue-first, not recency-first. The user is reading
//     this view to know what needs attention. A batch that's 6 days
//     overdue must surface above one that started 2 hours ago.
//   • Contam branch: option A — excluded entirely. Spec says
//     "active batches" and contam is terminal; it belongs in a
//     future Archive/Trash view, not here.
//   • The aggregate progress strip in the floating bar is the MEAN
//     of per-batch pct_complete. It's a one-pixel line, not a
//     meter — it whispers, doesn't shout.
//   • The "Move to next phase →" chip on overdue batches is a
//     visual placeholder only (no wire-up), but it's positioned as
//     the visually dominant click so the eye lands there.
//   • Count-up uses Framer Motion's useMotionValue + useTransform +
//     animate, GPU-only.
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
  CircleNotch,
} from 'phosphor-react'

import {
  ApiError,
  getBatches,
  type BatchRow,
} from '../lib/api'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: BatchRow[] }

// Terminal statuses — these batches leave the incubating view.
// (See server/src/db/schema.sql batch.status values.)
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'SPENT',
  'CONTAMINATED',
  'HARVESTED',
  'ARCHIVED',
])

// Stages where a target_date represents the colonization deadline.
// Other stages (FRUITING) use fruiting_target_end.
const COLONIZING_STAGES: ReadonlySet<string> = new Set([
  'INCUBATING',
  'COLONIZING',
  'SPAWN_RUN',
  'INOCULATED',
  'INOCULATION',
])

// Per the spec: derive a single percentage from the joined
// fields when pct_complete is not present.
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

  // Prefer server-computed pct_complete if present.
  const rawPct = (row as unknown as { pct_complete?: number | string })
    .pct_complete
  let pct: number
  if (rawPct != null && rawPct !== '') {
    const n = typeof rawPct === 'string' ? parseFloat(rawPct) : rawPct
    pct = Number.isFinite(n) ? n : 0
  } else {
    // Compute client-side: (now - start) / (target - start) * 100.
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

  // Overdue = now is past the target AND we haven't reached 100%.
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
  // SQLite returns "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS".
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

// Prevent two parallel fetches on rapid re-mount.
let loadInFlight: Promise<void> | null = null

export default function IncubatingView() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

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

  // Re-mount when row identity changes so local entry animations replay.
  return (
    <IncubatingReady
      key={state.rows.length + ':' + (state.rows[0]?.id ?? 'empty')}
      rows={state.rows}
      onReload={load}
    />
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
  onReload: () => void
}) {
  // Active filter + overdue-first sort.
  const active = useMemo(() => {
    const filtered = rows.filter((b) => {
      const status = (b.status ?? '').toUpperCase()
      if (TERMINAL_STATUSES.has(status)) return false
      // Spec: is_contaminated === 1 → exclude (option A).
      const ic = (b as unknown as { is_contaminated?: number | boolean })
        .is_contaminated
      if (ic === 1 || ic === true) return false
      return true
    })

    const scored = filtered.map((b) => {
      const p = deriveProgress(b)
      return { row: b, ...p }
    })

    // Overdue first (most-overdue on top), then on-track by closest target.
    scored.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
      // Within overdue: larger pct past 100 = more overdue visually.
      if (a.isOverdue && b.isOverdue) return b.pct - a.pct
      // On-track: earliest target date first.
      const at = a.target ? Date.parse(a.target) : Infinity
      const bt = b.target ? Date.parse(b.target) : Infinity
      if (at !== bt) return at - bt
      // Tie-break: most recently started first.
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
      {/* Floating sticky top bar — mirrors DailyView */}
      <FloatingTopBar
        activeCount={active.length}
        overdueCount={overdueCount}
        meanPct={meanPct}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto w-full max-w-2xl px-4 pt-2 pb-28"
      >
        {/* Header */}
        <div className="pt-2">
          <div className="flex items-center gap-3">
            <span className="eyebrow-tag">Incubating</span>
            <span className="text-[10px] uppercase tracking-eyebrow text-ink/40">
              Step 3 · Colonization Watch
            </span>
          </div>
          <h1 className="mt-5 font-serif text-5xl md:text-6xl leading-[0.95] tracking-tight text-ink">
            Active batches.
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-graphite-500">
            Overdue first, then on-track by closest target. A red bar means
            it's time to move the batch forward.
          </p>
        </div>

        {/* List */}
        {active.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <AnimatePresence initial={false}>
              {active.map((b, i) => (
                <BatchCard
                  key={b.row.id}
                  row={b.row}
                  pct={b.pct}
                  target={b.target}
                  started={b.started}
                  isOverdue={b.isOverdue}
                  // First card is the wide hero.
                  hero={i === 0}
                  // Cap stagger at 6 per spec.
                  entryDelayMs={Math.min(i * 80, 480)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Footnote */}
        <div className="mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow text-ink/40">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-700" />
          <span>End of bench</span>
        </div>

        {/* Reload trigger (hidden, but accessible) */}
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

  // Color the aggregate bar per the same rules as per-batch.
  const aggregateColor =
    overdueCount > 0
      ? '#B23A2A'
      : meanPct >= 100
      ? '#0A0A0A'
      : '#1F3D2B'

  return (
    <div className="sticky top-4 z-30 mx-4 md:mx-auto md:max-w-2xl">
      <div className="bezel-shell">
        <div className="bezel-core">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <span
                className={
                  'h-1.5 w-1.5 rounded-full ' +
                  (overdueCount > 0 ? 'bg-[#B23A2A]' : 'bg-moss-700')
                }
              />
              <span className="font-serif text-[17px] leading-none text-ink">
                Incubating
              </span>
              <span className="font-mono text-[11px] uppercase tracking-eyebrow text-ink/40 text-num">
                {String(activeCount).padStart(2, '0')}
                {overdueCount > 0 && (
                  <span className="ml-2 text-[#B23A2A]">
                    · {overdueCount} over
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-eyebrow text-ink/60">
              <span className="text-num">
                MEAN {Math.round(meanPct).toString().padStart(2, '0')}%
              </span>
            </div>
          </div>
          {/* Hairline aggregate progress — 1px tall, full width of the
              bar column. Not a meter; a whisper. */}
          <div className="h-px w-full bg-ink/[0.06] overflow-hidden">
            <motion.div
              style={{ width: widthPct, backgroundColor: aggregateColor }}
              className="h-full"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// BATCH CARD — Double-Bezel with custom progress bar
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

  // Animate fill width on mount.
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

  // Color rules — mirror spec exactly.
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
      {/* 2px left stripe for overdue — absolutely positioned inside
          the bezel-shell so it doesn't affect layout. */}
      <div
        className={
          'relative bezel-shell ' +
          (isOverdue ? 'ring-2 ring-[#B23A2A]/30' : '')
        }
      >
        {isOverdue && (
          <div
            aria-hidden
            className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[#B23A2A] z-10"
          />
        )}
        <div className="bezel-core p-5 md:p-6 min-h-[140px] relative">
          {/* Top row: eyebrow + species + meta */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span
                className={
                  'eyebrow-tag ' +
                  (isOverdue ? '!bg-[#B23A2A]/10 !text-[#B23A2A]' : '')
                }
              >
                {stage}
              </span>
              <h3 className="mt-2 font-serif text-2xl md:text-3xl leading-[1.05] tracking-tight text-ink truncate">
                {species}
              </h3>
            </div>
            <div className="shrink-0 text-right font-mono text-[11px] text-ink/50 leading-tight">
              <div>
                <span className="uppercase tracking-eyebrow text-ink/30">
                  Started
                </span>{' '}
                <span className="text-num">{startedStr}</span>
              </div>
              <div className="mt-0.5">
                <span className="uppercase tracking-eyebrow text-ink/30">
                  Days in
                </span>{' '}
                <span className="text-num">{days != null ? String(days).padStart(2, '0') : '—'}</span>
              </div>
            </div>
          </div>

          {/* Progress section */}
          <div className="mt-5">
            {/* Labels above the bar */}
            <div className="flex items-center justify-between text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono">
              <span>Day 0</span>
              <span>Target</span>
            </div>

            {/* Bar */}
            <div className="mt-1.5 h-1.5 rounded-full bg-ink/5 overflow-hidden">
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

            {/* Percentage below — Instrument Serif, count up */}
            <div className="mt-3 flex items-baseline gap-3">
              <CountUpPct value={pct} isOverdue={isOverdue} />
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink/40">
                {isComplete ? 'Complete' : isOverdue ? 'Overdue' : 'In progress'}
                {' · '}
                <span className="text-num">{targetStr}</span>
              </span>
            </div>
          </div>

          {/* Actions row */}
          <div className="mt-5 pt-4 border-t border-ink/[0.06] flex items-center justify-between">
            {isOverdue ? (
              <button
                type="button"
                className="group inline-flex items-center gap-2 bezel-core-sm px-3.5 py-1.5 rounded-full text-sm font-medium text-[#B23A2A] hover:ring-[#B23A2A]/40 transition-all duration-450 ease-fluid"
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
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-ink/50 hover:text-moss transition-colors duration-450 ease-fluid"
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
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-ink/30">
              {row.batch_id ?? `#${row.id}`}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// COUNT-UP PERCENT — Framer Motion MV + transform + animate
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
      className={
        'font-serif text-3xl leading-none text-num ' +
        (isOverdue ? 'text-[#B23A2A]' : 'text-ink')
      }
    >
      {display}
      <span className="text-ink/40">%</span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────

function IncubatingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-28">
      {/* Top bar skeleton */}
      <div className="sticky top-4 z-30 mb-4">
        <div className="bezel-shell">
          <div className="bezel-core">
            <div className="flex h-14 items-center justify-between px-4">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-ink/10" />
                <span className="h-3 w-20 rounded-full bg-ink/[0.06] animate-pulse" />
              </div>
              <div className="h-3 w-16 rounded-full bg-ink/[0.06] animate-pulse" />
            </div>
            <div className="h-px w-full bg-ink/[0.04]" />
          </div>
        </div>
      </div>

      <div>
        <span className="eyebrow-tag opacity-60">Incubating</span>
        <div className="mt-5 h-12 w-2/3 rounded-2xl bg-ink/[0.06] animate-pulse" />
        <div className="mt-3 h-3 w-1/2 rounded-full bg-ink/[0.05] animate-pulse" />
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
      <div className="bezel-shell">
        <div className="bezel-core p-5 md:p-6 min-h-[140px]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-2.5 w-16 rounded-full bg-ink/[0.06] animate-pulse" />
              <div className="h-7 w-3/4 rounded-full bg-ink/[0.07] animate-pulse" />
            </div>
            <div className="space-y-1 shrink-0">
              <div className="h-2 w-16 rounded-full bg-ink/[0.06] animate-pulse" />
              <div className="h-2 w-12 rounded-full bg-ink/[0.05] animate-pulse" />
            </div>
          </div>
          <div className="mt-5 space-y-2">
            <div className="flex justify-between">
              <div className="h-2 w-8 rounded-full bg-ink/[0.06] animate-pulse" />
              <div className="h-2 w-10 rounded-full bg-ink/[0.06] animate-pulse" />
            </div>
            <div className="h-1.5 w-full rounded-full bg-ink/[0.05] animate-pulse" />
            <div className="h-8 w-24 rounded-full bg-ink/[0.07] animate-pulse mt-3" />
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
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-28">
      <div className="pt-2">
        <span className="eyebrow-tag">Incubating</span>
        <h1 className="mt-5 font-serif text-5xl md:text-6xl leading-[0.95] tracking-tight text-ink">
          Incubator unreachable
        </h1>
      </div>
      <div className="mt-8">
        <div className="bezel-shell">
          <div className="bezel-core p-6">
            <div className="flex items-start gap-3">
              <CircleNotch
                size={22}
                weight="regular"
                className="text-amber_lab shrink-0 mt-0.5"
              />
              <div>
                <p className="text-[15px] text-ink leading-relaxed">{message}</p>
                <p className="mt-1 text-[12px] text-ink/50 font-mono">
                  GET /api/batches
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 group inline-flex items-center gap-2 btn-moss"
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

// ─────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      className="mt-12"
    >
      <div className="bezel-shell">
        <div className="bezel-core px-6 py-14 text-center">
          {/* Small moss spore/glyph — circle of dots radiating */}
          <SporeGlyph />
          <h2 className="mt-5 font-serif text-4xl md:text-5xl leading-[0.95] tracking-tight text-ink">
            No active batches.
          </h2>
          <p className="mt-3 text-[14px] text-graphite-500 max-w-sm mx-auto">
            Nothing colonizing, fruiting, or in spawn run. The bench is clear
            — start a new PC run to begin.
          </p>
        </div>
      </div>
    </motion.div>
  )
}

function SporeGlyph() {
  // A small moss-tinted spore glyph: central dot with 8 surrounding
  // dots in a circle, all hand-tuned radii — never a generic spinner.
  return (
    <div className="mx-auto h-12 w-12 rounded-full bg-moss-700/8 text-moss-700 flex items-center justify-center">
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="14" cy="14" r="2" fill="#1F3D2B" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const angle = (i / 8) * Math.PI * 2
          const x = 14 + Math.cos(angle) * 7
          const y = 14 + Math.sin(angle) * 7
          return <circle key={i} cx={x} cy={y} r="1" fill="#1F3D2B" opacity="0.55" />
        })}
      </svg>
    </div>
  )
}
