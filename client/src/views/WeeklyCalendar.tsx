// =============================================================
// Myco Lab — 28-Day Horizon (Phase 3 Step 5)
//
// Mobile-overhaul changes:
//  - H1 down to text-4xl/6xl.
//  - Stat row drops to 2 cols on mobile (was 2/4 already).
//  - Mobile fallback list uses break-words/min-w-0 on each
//    task line, so the title can wrap on a 360dp screen.
//  - The "Window" stat tile value is allowed to truncate so
//    "Mar 14 – Apr 10" doesn't push the tile out of the grid.
//  - The Gantt tooltips are unchanged on desktop (md+) and
//    hidden on mobile to keep the tap surface focused.
//  - All interactive elements (GanttCell buttons) carry
//    min-h-[44px] for touch.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowClockwise,
  CalendarBlank,
  WifiSlash,
} from 'phosphor-react'

import {
  ApiError,
  getTasksInRange,
  type TaskRow,
} from '../lib/api'
import { HelpTooltip } from '../components/HelpTooltip'
import { ServerUrlModal } from '../components/ServerUrlModal'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; startDate: string; endDate: string; tasks: TaskRow[] }

type TrackKey = 'pc' | 'inoculate' | 'harvest'

interface Track {
  key: TrackKey
  label: string
  shortLabel: string
  color: string
  ring: string
  bg: string
  match: (taskType: string) => boolean
}

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const HORIZON_DAYS = 28

const TRACKS: Track[] = [
  {
    key: 'pc',
    label: 'PC Runs',
    shortLabel: 'PC',
    color: '#B23A2A',
    ring: 'ring-[#B23A2A]/35',
    bg: 'bg-[#B23A2A]/10',
    match: (t) => t.startsWith('PC_RUN_'),
  },
  {
    key: 'inoculate',
    label: 'Inoculations',
    shortLabel: 'INOC',
    color: '#1F3D2B',
    ring: 'ring-moss-700/35',
    bg: 'bg-moss-700/12',
    match: (t) =>
      t === 'INOCULATE_GEN1' ||
      t === 'INOCULATE_BULK' ||
      t === 'G2G_TRANSFER' ||
      t === 'INOCULATE_LC',
  },
  {
    key: 'harvest',
    label: 'Harvests',
    shortLabel: 'HARV',
    color: '#B97A1F',
    ring: 'ring-amber_lab/40',
    bg: 'bg-amber_lab/12',
    match: (t) => t === 'HARVEST' || t === 'START_FRUITING',
  },
]

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10))
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function dayLabel(d: Date): { weekday: string; day: string } {
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    day: String(d.getDate()),
  }
}

function trackFor(taskType: string): Track | null {
  for (const t of TRACKS) if (t.match(taskType)) return t
  return null
}

function humanizeType(t: string): string {
  const map: Record<string, string> = {
    PC_RUN_GRAIN: 'PC · Grain',
    PC_RUN_BULK: 'PC · Bulk',
    PC_RUN_MICROLAB: 'PC · Microlab',
    INOCULATE_GEN1: 'Inoc · Gen 1',
    INOCULATE_BULK: 'Inoc · Bulk',
    G2G_TRANSFER: 'G2G Transfer',
    INOCULATE_LC: 'Inoc · LC',
    START_FRUITING: 'Start Fruiting',
    HARVEST: 'Harvest',
  }
  return map[t] ?? t.replace(/_/g, ' ')
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null

export default function WeeklyCalendar() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  const { start, end } = useMemo(() => {
    const today = new Date()
    return {
      start: isoDate(today),
      end: isoDate(addDays(today, HORIZON_DAYS - 1)),
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    if (loadInFlight) return loadInFlight
    setState({ kind: 'loading' })
    const work = (async () => {
      try {
        const tasks = await getTasksInRange(start, end)
        setState({ kind: 'ready', startDate: start, endDate: end, tasks })
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Could not load the 28-day horizon.'
        setState({ kind: 'error', message })
      }
    })()
    loadInFlight = work.finally(() => {
      loadInFlight = null
    })
    return loadInFlight
  }, [start, end])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => {
    void loadRef.current()
  }, [load])

  if (state.kind === 'loading') return <CalendarSkeleton />
  if (state.kind === 'error') {
    return <CalendarError message={state.message} onRetry={load} />
  }

  return (
    <CalendarReady
      key={state.startDate + ':' + state.tasks.length}
      startDate={state.startDate}
      endDate={state.endDate}
      tasks={state.tasks}
      onReload={load}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────

function CalendarReady({
  startDate,
  endDate,
  tasks,
  onReload,
}: {
  startDate: string
  endDate: string
  tasks: TaskRow[]
  onReload: () => void
}) {
  const reduceMotion = useReducedMotion()
  const start = parseDate(startDate)

  const days = useMemo(
    () => Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(start, i)),
    [start],
  )

  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const t of tasks) {
      const list = map.get(t.task_date) ?? []
      list.push(t)
      map.set(t.task_date, list)
    }
    return map
  }, [tasks])

  const trackTasksByDay = useMemo(() => {
    const out: Record<TrackKey, Map<string, TaskRow[]>> = {
      pc: new Map(),
      inoculate: new Map(),
      harvest: new Map(),
    }
    for (const t of tasks) {
      const trk = trackFor(t.task_type)
      if (!trk) continue
      const list = out[trk.key].get(t.task_date) ?? []
      list.push(t)
      out[trk.key].set(t.task_date, list)
    }
    return out
  }, [tasks])

  const weeks = useMemo(() => {
    const w: Date[][] = []
    for (let i = 0; i < days.length; i += 7) w.push(days.slice(i, i + 7))
    return w
  }, [days])

  const counts = useMemo(() => {
    const c: Record<TrackKey, number> = { pc: 0, inoculate: 0, harvest: 0 }
    for (const t of tasks) {
      const trk = trackFor(t.task_type)
      if (trk) c[trk.key]++
    }
    return c
  }, [tasks])

  const totalInWindow = tasks.length
  const daysWithWork = useMemo(() => {
    let n = 0
    for (const d of days) if ((tasksByDay.get(isoDate(d)) ?? []).length > 0) n++
    return n
  }, [days, tasksByDay])

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
            <span className="eyebrow-tag">Calendar</span>
          </div>
          <h1 className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-5xl leading-tight tracking-tight text-balance break-words" style={{ color: 'var(--surface-text)' }}>
            Four weeks ahead.
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: 'var(--surface-muted)' }}>
            Every scheduled task across the next {HORIZON_DAYS} days, color-coded
            by track. Hover or tap a day to see task details.
          </p>
        </div>

        {/* Window + count row */}
        <div className="mt-6 md:mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Window"
            value={`${formatDateShort(startDate)} – ${formatDateShort(endDate)}`}
            icon={<CalendarBlank size={16} weight="regular" />}
            tooltip="The rolling 28-day schedule window starting today."
          />
          <StatTile 
            label="Tasks" 
            value={String(totalInWindow).padStart(2, '0')} 
            tooltip="Total scheduled tasks in the 28-day window."
          />
          <StatTile
            label="Days with work"
            value={`${String(daysWithWork).padStart(2, '0')} / ${HORIZON_DAYS}`}
            tooltip="Number of days in the window that have at least one scheduled task."
          />
          <StatTile
            label="Tracks"
            value={`${TRACKS.length}`}
            tooltip="Active workflow pipelines."
          />
        </div>

        {/* Legend */}
        <div className="mt-4 md:mt-5 flex flex-wrap items-center gap-2">
          {TRACKS.map((t) => (
            <div
              key={t.key}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full min-h-[36px]"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: t.color }}
              />
              <span className="text-[11px] uppercase tracking-eyebrow font-medium" style={{ color: 'var(--surface-text)' }}>
                {t.label}
              </span>
              <span className="font-mono text-[10px] text-num" style={{ color: 'var(--surface-muted)' }}>
                {counts[t.key]}
              </span>
            </div>
          ))}
        </div>

        {/* Desktop Gantt */}
        <div className="mt-6 md:mt-8 hidden md:block">
          <div className="lab-card p-4 md:p-5">
            <GanttGrid
              days={days}
              trackTasksByDay={trackTasksByDay}
            />
          </div>
        </div>

        {/* Mobile fallback: vertical list grouped by week */}
        <div className="mt-6 md:mt-8 md:hidden space-y-3">
          {weeks.map((wk, wi) => (
            <MobileWeek
              key={wi}
              weekNumber={wi + 1}
              days={wk}
              tasksByDay={tasksByDay}
            />
          ))}
        </div>

        <div className="mt-10 md:mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          <span>End of horizon</span>
        </div>
      </motion.div>

      <button
        type="button"
        onClick={onReload}
        aria-label="Refresh"
        className="sr-only"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// GANTT GRID (desktop)
// ─────────────────────────────────────────────────────────────

function GanttGrid({
  days,
  trackTasksByDay,
}: {
  days: Date[]
  trackTasksByDay: Record<TrackKey, Map<string, TaskRow[]>>
}) {
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  return (
    <div className="grid grid-cols-4 gap-3 min-w-0">
      {weeks.map((wk, wi) => (
        <div key={wi} className="rounded-2xl p-2.5 min-w-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-baseline justify-between mb-2 px-1 gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-eyebrow font-medium" style={{ color: 'var(--surface-muted)' }}>
              Week {wi + 1}
            </span>
            <span className="font-mono text-[10px] text-num whitespace-nowrap" style={{ color: 'var(--surface-muted)' }}>
              {dayHeaderShort(wk[0])} – {dayHeaderShort(wk[wk.length - 1])}
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2 min-w-0">
            {wk.map((d) => {
              const { weekday, day } = dayLabel(d)
              const hasWork = TRACKS.some((t) =>
                (trackTasksByDay[t.key].get(isoDate(d)) ?? []).length > 0,
              )
              const isToday = isoDate(d) === isoDate(new Date())
              return (
                <div
                  key={d.toISOString()}
                  className={
                    'flex flex-col items-center justify-center rounded-lg py-1 text-center ' +
                    (isToday ? '' : 'bg-transparent')
                  }
                  style={isToday ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' } : {}}
                >
                  <span className="text-[9px] uppercase tracking-eyebrow font-mono" style={{ color: 'var(--surface-muted)' }}>
                    {weekday}
                  </span>
                  <span
                    className={
                      'font-mono text-[11px] text-num mt-0.5'
                    }
                    style={hasWork ? { color: 'var(--surface-text)' } : { color: 'var(--surface-muted)', opacity: 0.5 }}
                  >
                    {day}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="space-y-2">
            {TRACKS.map((track) => (
              <div key={track.key}>
                <div className="flex items-baseline justify-between mb-1 px-1">
                  <span className="text-[9px] uppercase tracking-eyebrow font-mono" style={{ color: 'var(--surface-muted)' }}>
                    {track.shortLabel}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {wk.map((d) => {
                    const day = isoDate(d)
                    const list = trackTasksByDay[track.key].get(day) ?? []
                    return (
                      <GanttCell
                        key={day + track.key}
                        tasks={list}
                        track={track}
                        day={d}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function GanttCell({
  tasks,
  track,
  day,
}: {
  tasks: TaskRow[]
  track: Track
  day: Date
}) {
  const [hover, setHover] = useState(false)
  if (tasks.length === 0) {
    return (
      <div className="h-7 rounded-md bg-transparent" />
    )
  }
  return (
    <div className="relative">
      <button
        type="button"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={
          'w-full min-h-[44px] md:min-h-0 md:h-7 rounded-md ring-1 ' +
          track.ring +
          ' ' +
          track.bg +
          ' flex items-center justify-center text-[10px] font-mono text-num transition-all duration-450 ease-fluid hover:brightness-95 active:scale-[0.97]'
        }
        style={{ color: track.color }}
        aria-label={`${tasks.length} ${track.label.toLowerCase()} on ${isoDate(day)}`}
      >
        {tasks.length}
      </button>

      <AnimatePresence>
        {hover && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1.5 w-56 pointer-events-none"
          >
            <div className="lab-card p-3 text-left shadow-2xl">
              <div className="text-[10px] uppercase tracking-eyebrow font-mono" style={{ color: 'var(--surface-muted)' }}>
                {isoDate(day)} · {track.label}
              </div>
              <ul className="mt-1.5 space-y-1">
                {tasks.slice(0, 5).map((t) => (
                  <li
                    key={t.id}
                    className="text-[12px] leading-tight flex items-baseline gap-1.5 min-w-0"
                    style={{ color: 'var(--surface-text)' }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0 mt-1"
                      style={{ backgroundColor: track.color }}
                    />
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
                {tasks.length > 5 && (
                  <li className="text-[11px] font-mono" style={{ color: 'var(--surface-muted)' }}>
                    +{tasks.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MOBILE WEEK
// ─────────────────────────────────────────────────────────────

function MobileWeek({
  weekNumber,
  days,
  tasksByDay,
}: {
  weekNumber: number
  days: Date[]
  tasksByDay: Map<string, TaskRow[]>
}) {
  return (
    <div className="lab-card p-4 min-w-0">
      <div className="flex items-baseline justify-between mb-3 gap-2 min-w-0">
        <span className="eyebrow-tag">Week {weekNumber}</span>
        <span className="font-mono text-[10px] text-num whitespace-nowrap" style={{ color: 'var(--surface-muted)' }}>
          {dayHeaderShort(days[0])} – {dayHeaderShort(days[days.length - 1])}
        </span>
      </div>
      <div className="space-y-2">
        {days.map((d) => {
          const key = isoDate(d)
          const list = tasksByDay.get(key) ?? []
          return (
            <div key={key} className="rounded-2xl p-3 min-w-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-baseline justify-between mb-1.5 gap-2 min-w-0">
                <span className="font-sans font-bold text-base md:text-lg leading-none" style={{ color: 'var(--surface-text)' }}>
                  {d.toLocaleDateString('en-US', { weekday: 'long' })}
                </span>
                <span className="font-mono text-[11px] text-num whitespace-nowrap" style={{ color: 'var(--surface-muted)' }}>
                  {dayHeaderShort(d)}
                </span>
              </div>
              {list.length === 0 ? (
                <div className="text-[12px] font-mono" style={{ color: 'var(--surface-muted)', opacity: 0.5 }}>—</div>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((t) => {
                    const trk = trackFor(t.task_type)
                    const color = trk?.color ?? '#4A4A4A'
                    return (
                      <li
                        key={t.id}
                        className="flex items-baseline gap-2 text-[13px] min-w-0"
                        style={{ color: 'var(--surface-text)' }}
                      >
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full shrink-0 mt-1.5"
                          style={{ backgroundColor: color }}
                        />
                        <span className="break-words min-w-0 flex-1">
                          {t.title}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-eyebrow shrink-0 whitespace-nowrap" style={{ color: 'var(--surface-muted)' }}>
                          {humanizeType(t.task_type)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  icon,
  tooltip,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  tooltip?: string
}) {
  return (
    <div className="lab-card px-3 md:px-4 py-4 min-w-0">
      <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-eyebrow font-medium truncate" style={{ color: 'var(--surface-muted)' }}>
            {label}
          </span>
          {tooltip && <HelpTooltip title={label} text={tooltip} />}
        </div>
        {icon && <span className="shrink-0" style={{ color: 'var(--surface-muted)' }}>{icon}</span>}
      </div>
      <div className="font-sans font-bold text-lg md:text-3xl leading-none text-num truncate" style={{ color: 'var(--surface-text)' }}>
        {value}
      </div>
    </div>
  )
}

function formatDateShort(s: string): string {
  const d = parseDate(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function dayHeaderShort(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// SKELETON + ERROR
// ─────────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag opacity-60">Calendar</span>
        <div className="mt-5 h-9 w-2/3 rounded-2xl skeleton" />
      </div>
      <div className="mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="lab-card px-3 md:px-4 py-4">
            <div className="h-2 w-16 rounded-full skeleton" />
            <div className="mt-3 h-5 w-20 rounded-full skeleton" />
          </div>
        ))}
      </div>
      <div className="mt-8 lab-card p-4 md:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl skeleton" />
          ))}
        </div>
      </div>
    </div>
  )
}

function CalendarError({
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
        <span className="eyebrow-tag">Calendar</span>
        <h1 className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-6xl leading-tight tracking-tight text-balance break-words" style={{ color: 'var(--surface-text)' }}>
          Calendar unreachable
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
              <p className="text-[15px] leading-relaxed break-words" style={{ color: 'var(--surface-text)' }}>
                {message}
              </p>
              <p className="mt-1 text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
                GET /api/tasks/range
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="min-h-[44px] group inline-flex items-center gap-2 btn-primary"
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
              className="btn-ghost min-h-[44px] inline-flex items-center gap-2"
            >
              Change Server URL
            </button>
          </div>
        </div>
      </div>
      {showUrlModal && <ServerUrlModal onClose={() => setShowUrlModal(false)} />}
    </div>
  )
}
