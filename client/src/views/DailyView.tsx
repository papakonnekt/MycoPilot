// =============================================================
// Myco Lab — Daily Bench (Step 2)
//
// Mobile-first operational dashboard. One-handed use in a flow
// hood. Huge touch targets. Soft Structuralism design language:
// paper #F5F4F0 / moss #1F3D2B / ink #0A0A0A, Geist + Instrument
// Serif, Double-Bezel component pattern, fluid cubic-bezier.
//
// Mobile-overhaul changes (this pass):
//  - H1 down from text-5xl/6xl to text-4xl/6xl so it never
//    collides with the sticky top bar on a 360dp screen.
//  - The text column in every TaskCard has min-w-0; long titles
//    wrap with break-words instead of being truncated.
//  - The H1 uses text-balance so two-word dates don't create
//    awkward orphan lines.
//  - The sticky FloatingTopBar lifts off the top safe-area
//    inset (top-[calc(env(safe-area-inset-top)+0.5rem)]) so the
//    status pill clears the camera notch on Android.
//  - Bottom padding on the column is governed by Layout (it
//    accounts for the bottom nav + safe area).
//
// Data flow:
//   1. On mount, GET /api/tasks/today → DailyViewPayload.
//   2. Group by task_type (literal string from the DB).
//   3. Optimistic update on Mark Complete (PATCH /tasks/:id/complete).
//   4. Optimistic update on Contam/Toss (PATCH /tasks/batch/:id/mark-spent).
//
// The Contam action is shown only when the task is bound to a real
// batch (batch_id present) AND the task type actually represents
// ongoing lab work that could fail (HARVEST, INOCULATE_*, MARK_SPENT_TOSS,
// MOVE_TO_FRIDGE, START_FRUITING).
//
// Design decisions:
//   - Contam interaction: persistent secondary text-button (option B).
//   - Pull-to-refresh: skipped.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  type PanInfo,
  useReducedMotion,
} from 'framer-motion'
import {
  ArrowClockwise,
  Check,
  CircleWavyCheck,
  Trash,
  Warning,
  WifiSlash,
  X,
} from 'phosphor-react'

import {
  ApiError,
  completeTask,
  getTodayTasks,
  markBatchSpent,
  type DailyViewPayload,
  type TaskRow,
} from '../lib/api'
import { HelpTooltip } from '../components/HelpTooltip'
import { ServerUrlModal } from '../components/ServerUrlModal'

// ─────────────────────────────────────────────────────────────
// TYPES — local to this view
// ─────────────────────────────────────────────────────────────

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payload: DailyViewPayload }

interface TaskGroup {
  taskType: string
  label: string
  tasks: TaskRow[]
}

// Task types where a batch is actively in play and contam/spent
// is a real possibility. Derived from the schema's full task_type
// taxonomy (see server/src/db/schema.sql line 305+).
const CONTAM_ELIGIBLE_TASK_TYPES: ReadonlySet<string> = new Set([
  'INOCULATE_GEN1',
  'INOCULATE_BULK',
  'G2G_TRANSFER',
  'HARVEST',
  'MARK_SPENT_TOSS',
  'MOVE_TO_FRIDGE',
  'START_FRUITING',
])

// Map raw SCREAMING_SNAKE task_type strings to a calmer title-case label.
function humanizeTaskType(taskType: string): string {
  const map: Record<string, string> = {
    PC_RUN_GRAIN: 'PC Run · Grain',
    PC_RUN_BULK: 'PC Run · Bulk',
    PC_RUN_MICROLAB: 'PC Run · Microlab',
    INOCULATE_GEN1: 'Inoculation · Gen 1',
    G2G_TRANSFER: 'G2G Transfer',
    INOCULATE_BULK: 'Inoculation · Bulk',
    PASTEURIZE_BULK_CVG: 'Pasteurize · CVG',
    LOAD_FRUITING_CHAMBER: 'Load Fruiting',
    START_FRUITING: 'Start Fruiting',
    HARVEST: 'Harvest',
    MARK_SPENT_TOSS: 'Mark Spent',
    MOVE_TO_FRIDGE: 'Move to Fridge',
    PREP_LC: 'Prep LC',
    PREP_AGAR: 'Prep Agar',
    INOCULATE_LC: 'Inoculate LC',
    COLLECT_SPORE_PRINT: 'Spore Print',
    CLONE_BEST_CLUSTER: 'Clone Cluster',
    START_NEW_LC_FROM_SPORE: 'New LC from Spore',
    FLAG_SENESCENCE: 'Flag Senescence',
    REORDER_MATERIAL: 'Reorder',
    REVIEW_BATCH: 'Review Batch',
    OVER_BUDGET_FLAG: 'Over Budget',
  }
  if (map[taskType]) return map[taskType]
  return taskType
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function isContamEligible(task: TaskRow): boolean {
  if (task.batch_id == null) return false
  return CONTAM_ELIGIBLE_TASK_TYPES.has(task.task_type)
}

function isOpen(task: TaskRow): boolean {
  return task.status !== 'COMPLETE' && task.status !== 'SKIPPED'
}

function formatDateLong(d: Date): string {
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  const day = d.getDate()
  return `${weekday} · ${month} ${day}`
}

function formatMinutesShort(mins: number | undefined | null): string {
  if (!mins) return '— min'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const STATUS_PRIORITY: Record<string, number> = {
  OVER_BUDGET_WARNING: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
  FLAGGED: 3,
  RESCHEDULED: 4,
  COMPLETE: 5,
  SKIPPED: 6,
}

function sortTasks(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 99
    const pb = STATUS_PRIORITY[b.status] ?? 99
    if (pa !== pb) return pa - pb
    return (a.id ?? 0) - (b.id ?? 0)
  })
}

function groupTasks(tasks: TaskRow[]): TaskGroup[] {
  const buckets = new Map<string, TaskRow[]>()
  for (const t of tasks) {
    const key = t.task_type || 'OTHER'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(t)
  }
  const groups: TaskGroup[] = []
  for (const [taskType, list] of buckets) {
    groups.push({
      taskType,
      label: humanizeTaskType(taskType),
      tasks: sortTasks(list),
    })
  }
  groups.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.tasks[0]?.status] ?? 99
    const pb = STATUS_PRIORITY[b.tasks[0]?.status] ?? 99
    if (pa !== pb) return pa - pb
    return a.taskType.localeCompare(b.taskType)
  })
  return groups
}

// ─────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null

export default function DailyView() {
  const [state, setState] = useState<FetchState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    if (loadInFlight) return loadInFlight
    setState({ kind: 'loading' })
    const work = (async () => {
      try {
        const payload = await getTodayTasks()
        setState({ kind: 'ready', payload })
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Could not load today's bench."
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

  if (state.kind === 'loading') {
    return <DailyViewSkeleton />
  }
  if (state.kind === 'error') {
    return <DailyViewError message={state.message} onRetry={load} />
  }

  return (
    <DailyViewReady
      key={state.payload.date + ':' + state.payload.tasks.length}
      payload={state.payload}
      onReload={load}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// READY: the actual daily bench
// ─────────────────────────────────────────────────────────────

function DailyViewReady({
  payload,
  onReload,
}: {
  payload: DailyViewPayload
  onReload: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [tasks, setTasks] = useState<TaskRow[]>(payload.tasks)
  const [toast, setToast] = useState<string | null>(null)
  const [contamTarget, setContamTarget] = useState<TaskRow | null>(null)

  const groups = useMemo(() => groupTasks(tasks), [tasks])
  const openCount = useMemo(() => tasks.filter(isOpen).length, [tasks])
  const totalOpenMins = useMemo(
    () =>
      tasks
        .filter(isOpen)
        .reduce((s, t) => s + (t.estimated_mins ?? 0), 0),
    [tasks],
  )

  const handleComplete = useCallback(
    async (task: TaskRow) => {
      const snapshot = tasks
      setTasks((prev) => prev.filter((t) => t.id !== task.id))
      try {
        await completeTask(task.id)
      } catch (err) {
        setTasks(snapshot)
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Could not mark complete.'
        setToast(message)
        window.setTimeout(() => setToast(null), 4000)
      }
    },
    [tasks],
  )

  const handleConfirmContam = useCallback(async () => {
    const target = contamTarget
    if (!target) return
    if (target.batch_id == null) {
      setContamTarget(null)
      return
    }
    const snapshot = tasks
    setTasks((prev) => prev.filter((t) => t.id !== target.id))
    setContamTarget(null)
    try {
      await markBatchSpent(target.batch_id)
      onReload()
    } catch (err) {
      setTasks(snapshot)
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Could not mark batch spent.'
      setToast(message)
      window.setTimeout(() => setToast(null), 4000)
    }
  }, [contamTarget, onReload, tasks])

  return (
    <div className="relative">
      {/* Floating sticky top bar */}
      <FloatingTopBar openCount={openCount} totalMins={totalOpenMins} />

      {/* Main column */}
      <motion.div
        key={payload.date}
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto w-full max-w-2xl min-w-0 px-1 pt-2 pb-6"
      >
        {/* Header */}
        <div className="px-3 pt-2 min-w-0">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="eyebrow-tag">Today</span>
          </div>
          <h1 className="mt-4 md:mt-5 font-sans text-4xl md:text-5xl font-bold leading-[0.95] tracking-tight text-surface-text text-balance break-words">
            {formatDateLong(parseTaskDate(payload.date))}
          </h1>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed" style={{ color: 'var(--surface-muted)' }}>
            Tap ✓ to mark a step complete. Big targets for gloved hands.
          </p>
        </div>

        {/* Budget strip */}
        <BudgetStrip
          totalMins={totalOpenMins}
          budgetMins={
            (payload as unknown as { dailyBudgetMins?: number }).dailyBudgetMins ?? 480
          }
          isOverBudget={Boolean(
            (payload as unknown as { isOverBudget?: boolean }).isOverBudget,
          )}
          warningCount={
            (payload as unknown as { warningCount?: number }).warningCount ?? 0
          }
        />

        {/* Groups */}
        {groups.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-6 md:mt-8 space-y-6 md:space-y-9">
            {groups.map((group, gi) => (
              <TaskGroupSection
                key={group.taskType}
                group={group}
                index={gi}
                onComplete={handleComplete}
                onRequestContam={(t) => setContamTarget(t)}
              />
            ))}
          </div>
        )}

        {/* Footnote */}
        <div className="mt-10 md:mt-12 px-3 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          <span>End of bench</span>
        </div>
      </motion.div>

      {/* Confirm sheet — safe-area aware via inline style. */}
      <AnimatePresence>
        {contamTarget && (
          <ContamConfirmSheet
            task={contamTarget}
            onCancel={() => setContamTarget(null)}
            onConfirm={handleConfirmContam}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// FLOATING TOP BAR
// ─────────────────────────────────────────────────────────────

function FloatingTopBar({
  openCount,
  totalMins,
}: {
  openCount: number
  totalMins: number
}) {
  return (
    <div
      className="sticky z-30 mx-3 md:mx-auto md:max-w-2xl"
      style={{ top: 'calc(max(env(safe-area-inset-top, 0px), 24px) + 0.5rem)' }}
    >
      <div className="bezel-shell">
        <div className="bezel-core flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="live-dot shrink-0" />
            <span className="font-sans font-semibold text-[16px] leading-none truncate" style={{ color: 'var(--surface-text)' }}>
              Today
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 font-mono text-[11px] uppercase tracking-eyebrow shrink-0" style={{ color: 'var(--surface-muted)' }}>
            <span className="text-num whitespace-nowrap" style={{ color: 'var(--bio-green)' }}>
              {String(openCount).padStart(2, '0')} OPEN
            </span>
            <span className="h-3 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <span className="text-num whitespace-nowrap">
              {formatMinutesShort(totalMins)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// BUDGET STRIP
// ─────────────────────────────────────────────────────────────

function BudgetStrip({
  totalMins,
  budgetMins,
  isOverBudget,
  warningCount,
}: {
  totalMins: number
  budgetMins: number
  isOverBudget: boolean
  warningCount: number
}) {
  const pct = budgetMins > 0 ? Math.min(100, Math.round((totalMins / budgetMins) * 100)) : 0

  return (
    <div className="mt-5 md:mt-6 px-3">
      <div className="lab-card-accent px-4 md:px-5 py-4">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
              Time budget
            </span>
            <HelpTooltip
              title="Daily Time Budget"
              text="Total estimated minutes for open tasks today vs. your configured daily limit. Red = over budget — consider rescheduling lower-priority tasks."
            />
          </div>
          <span
            className="font-mono text-[11px] uppercase tracking-eyebrow whitespace-nowrap"
            style={{ color: isOverBudget ? 'var(--danger)' : 'var(--surface-muted)' }}
          >
            {formatMinutesShort(totalMins)} / {formatMinutesShort(budgetMins)}
          </span>
        </div>
        <div className="progress-track mt-3">
          <div
            className={'progress-fill' + (isOverBudget ? ' progress-fill-danger' : pct > 75 ? ' progress-fill-warn' : '')}
            style={{ width: `${pct}%` }}
          />
        </div>
        {warningCount > 0 && (
          <div className="mt-3 flex items-center gap-2 text-[12px] min-w-0" style={{ color: 'var(--warn)' }}>
            <Warning size={14} weight="regular" className="shrink-0" />
            <span className="break-words">
              {warningCount} warning{warningCount === 1 ? '' : 's'} on the bench
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// TASK GROUP SECTION
// ─────────────────────────────────────────────────────────────

function TaskGroupSection({
  group,
  index,
  onComplete,
  onRequestContam,
}: {
  group: TaskGroup
  index: number
  onComplete: (task: TaskRow) => void
  onRequestContam: (task: TaskRow) => void
}) {
  return (
    <section className="min-w-0">
      <div className="px-3 mb-3 flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-eyebrow font-semibold truncate" style={{ color: 'var(--bio-green)' }}>
            {group.label}
          </span>
          <HelpTooltip
            title={group.label}
            text={`Tasks grouped by the ${group.label} phase of your workflow.`}
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-num shrink-0" style={{ color: 'var(--surface-muted)' }}>
          {String(group.tasks.length).padStart(2, '0')}
        </span>
      </div>
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {group.tasks.map((task, ti) => (
            <TaskCard
              key={task.id}
              task={task}
              entryDelayMs={Math.min(index * 80 + ti * 50, 450)}
              onComplete={onComplete}
              onRequestContam={onRequestContam}
            />
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// TASK CARD
// ─────────────────────────────────────────────────────────────

function TaskCard({
  task,
  entryDelayMs,
  onComplete,
  onRequestContam,
}: {
  task: TaskRow
  entryDelayMs: number
  onComplete: (task: TaskRow) => void
  onRequestContam: (task: TaskRow) => void
}) {
  const reduceMotion = useReducedMotion()

  const [peekX, setPeekX] = useState(0)
  const showContam = isContamEligible(task)
  const peekThreshold = 56

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (!showContam) {
      setPeekX(0)
      return
    }
    const dx = info.offset.x
    if (dx < -peekThreshold) setPeekX(-peekThreshold)
    else setPeekX(0)
  }

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{
        opacity: 1,
        y: 0,
        x: reduceMotion ? 0 : peekX,
      }}
      exit={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, x: 24, scale: 0.95 }
      }
      transition={{
        duration: 0.5,
        ease: [0.32, 0.72, 0, 1],
        delay: entryDelayMs / 1000,
      }}
      drag={showContam && !reduceMotion ? 'x' : false}
      dragConstraints={{ left: -peekThreshold, right: 0 }}
      dragElastic={0.15}
      onDragEnd={handleDragEnd}
      dragMomentum={false}
      whileTap={{ cursor: 'grabbing' }}
      className="relative"
    >
      {showContam && (
        <div
          aria-hidden
          className="absolute inset-y-1.5 right-1.5 flex items-center pr-2 pointer-events-none"
        >
          <div className="rounded-full bg-[#B23A2A]/10 ring-1 ring-[#B23A2A]/25 px-3 py-1.5 text-[11px] font-medium uppercase tracking-eyebrow text-[#B23A2A]">
            Contam
          </div>
        </div>
      )}

      <div className="lab-card">
        <div className="p-4 md:p-5 min-h-[88px]">
          <div className="flex items-start gap-3 md:gap-4 min-w-0">
            {/* Text column */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap min-w-0">
                <StatusDot status={task.status} />
                <span className="text-[10px] uppercase tracking-eyebrow font-medium" style={{ color: 'var(--surface-muted)' }}>
                  {humanizeTaskStatus(task.status)}
                </span>
                {task.is_overdue ? (
                  <span className="text-[10px] uppercase tracking-eyebrow font-semibold" style={{ color: 'var(--warn)' }}>
                    Overdue
                  </span>
                ) : null}
              </div>
              <h3 className="text-[17px] md:text-2xl font-semibold leading-snug break-words" style={{ color: 'var(--surface-text)' }}>
                {task.title}
              </h3>
              <div className="mt-1.5 flex items-center gap-2 text-sm flex-wrap min-w-0" style={{ color: 'var(--surface-muted)' }}>
                {task.species_name && <span className="break-words">{task.species_name}</span>}
                {task.species_name && task.batch_ref && (
                  <span className="h-1 w-1 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />
                )}
                {task.batch_ref && (
                  <span className="font-mono uppercase tracking-wide_lab text-[12px] break-all" style={{ color: 'var(--bio-green)' }}>
                    {task.batch_ref}
                  </span>
                )}
                {(task.species_name || task.batch_ref) && task.estimated_mins ? (
                  <span className="h-1 w-1 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />
                ) : null}
                {task.estimated_mins ? (
                  <span className="text-num whitespace-nowrap">{formatMinutesShort(task.estimated_mins)}</span>
                ) : null}
                {task.flush_number ? (
                  <>
                    <span className="h-1 w-1 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />
                    <span className="text-num whitespace-nowrap">Flush {task.flush_number}</span>
                  </>
                ) : null}
              </div>
            </div>

            {/* Massive Complete button */}
            <CompleteButton task={task} onClick={() => onComplete(task)} />
          </div>

          {/* Secondary contam action */}
          {showContam && (
            <div className="mt-3 md:mt-4 pt-3 md:pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                onClick={() => onRequestContam(task)}
                className="group min-h-[44px] inline-flex items-center gap-1.5 text-sm font-medium transition-colors duration-300"
                style={{ color: 'rgba(249, 112, 102, 0.7)' }}
              >
                <Trash size={14} weight="regular" />
                <span>Mark batch as spent (contam)</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// COMPLETE BUTTON
// ─────────────────────────────────────────────────────────────

function CompleteButton({
  task,
  onClick,
}: {
  task: TaskRow
  onClick: () => void
}) {
  const [completed, setCompleted] = useState(false)

  const handleClick = async () => {
    if (completed) return
    setCompleted(true)
    window.setTimeout(() => {
      onClick()
    }, 180)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Mark complete: ${task.title}`}
      className="group relative shrink-0 w-14 h-14 rounded-full active:scale-[0.92] transition-all duration-400"
      style={{
        background: completed
          ? 'var(--bio-green)'
          : 'rgba(52, 212, 104, 0.08)',
        border: `1px solid ${completed ? 'var(--bio-green)' : 'rgba(52, 212, 104, 0.2)'}`,
        boxShadow: completed ? 'var(--bio-green-glow)' : 'none',
        transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <span className="absolute inset-0 flex items-center justify-center transition-transform duration-400 group-hover:scale-[1.08]" style={{ transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}>
        <Check
          size={22}
          weight={completed ? 'bold' : 'regular'}
          style={{ color: completed ? '#080f0a' : 'var(--bio-green)', transition: 'color 400ms' }}
        />
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// CONTAM CONFIRM SHEET
// ─────────────────────────────────────────────────────────────

function ContamConfirmSheet({
  task,
  onCancel,
  onConfirm,
}: {
  task: TaskRow
  onCancel: () => void
  onConfirm: () => void
}) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contam-title"
    >
      <motion.button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(8, 15, 10, 0.75)' }}
      />

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
        transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
        className="relative w-full md:max-w-md mx-3 md:mx-4"
        style={{ marginBottom: 'calc(max(env(safe-area-inset-bottom,0px),16px) + 0.75rem)' }}
      >
        <div className="server-modal-shell">
          <div className="flex items-start justify-between gap-3 min-w-0 mb-4">
            <div className="min-w-0 flex-1">
              <span className="eyebrow-tag" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>
                Contam · Spent
              </span>
              <h2 id="contam-title" className="mt-3 font-sans font-bold text-2xl leading-tight break-words text-balance" style={{ color: 'var(--surface-text)' }}>
                Mark batch as spent?
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--surface-muted)' }}>
                Cancels all pending tasks for the batch and sets it to{' '}
                <span className="font-mono text-[12px]" style={{ color: 'var(--danger)' }}>SPENT</span>.
                Cannot be undone from the bench.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="shrink-0 -mt-1 -mr-1 min-h-[44px] min-w-[44px] h-10 w-10 rounded-full flex items-center justify-center transition-colors duration-300"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--surface-muted)' }}
            >
              <X size={16} weight="regular" />
            </button>
          </div>

          <div className="rounded-2xl px-4 py-3 mb-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-[10px] uppercase tracking-eyebrow mb-1" style={{ color: 'var(--surface-muted)' }}>Task</div>
            <div className="text-[15px] font-medium leading-snug break-words" style={{ color: 'var(--surface-text)' }}>{task.title}</div>
            {task.species_name && (
              <div className="mt-1 text-[12px] break-words" style={{ color: 'var(--surface-muted)' }}>
                {task.species_name}
                {task.batch_ref && (
                  <> · <span className="font-mono uppercase" style={{ color: 'var(--bio-green)' }}>{task.batch_ref}</span></>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
            <button type="button" onClick={onCancel} className="btn-ghost min-h-[44px]">
              Cancel
            </button>
            <button type="button" onClick={onConfirm} className="btn-danger min-h-[44px] justify-center">
              <Trash size={16} weight="regular" />
              <span>Mark spent</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────

function DailyViewSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-1 pt-2 pb-6">
      <div className="sticky z-30 mx-3 md:mx-auto md:max-w-2xl mb-4" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
        <div className="bezel-shell">
          <div className="bezel-core flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full skeleton" />
              <span className="h-3 w-14 skeleton" />
            </div>
            <div className="h-3 w-16 skeleton" />
          </div>
        </div>
      </div>
      <div className="px-3">
        <span className="eyebrow-tag opacity-60">Today</span>
        <div className="mt-5 h-9 w-2/3 rounded-2xl skeleton" />
        <div className="mt-3 h-3 w-1/2 rounded-full skeleton" />
      </div>
      <div className="mt-6 px-3">
        <div className="lab-card px-5 py-4">
          <div className="h-2 w-24 rounded-full skeleton" />
          <div className="mt-3 h-1 w-full rounded-full skeleton" />
        </div>
      </div>
      <div className="mt-8 px-3 space-y-3">
        <div className="h-2 w-20 rounded-full skeleton" />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="lab-card">
      <div className="p-4 md:p-5 min-h-[88px]">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex-1 min-w-0 space-y-3">
            <div className="h-2 w-16 rounded-full skeleton" />
            <div className="h-4 w-3/4 rounded-full skeleton" />
            <div className="h-3 w-1/2 rounded-full skeleton" />
          </div>
          <div className="w-14 h-14 rounded-full skeleton shrink-0" />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ERROR STATE
// ─────────────────────────────────────────────────────────────

function DailyViewError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const [showUrlModal, setShowUrlModal] = useState(false)

  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 px-1 pt-2 pb-6">
      <div className="px-3 pt-2">
        <span className="eyebrow-tag">Today</span>
        <h1 className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-5xl leading-tight tracking-tight text-balance break-words" style={{ color: 'var(--surface-text)' }}>
          Bench unreachable
        </h1>
      </div>

      <div className="mt-8 px-3">
        <div className="lab-card p-6">
          {/* Error icon + message */}
          <div className="flex items-start gap-3 min-w-0 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--danger-dim)' }}>
              <WifiSlash size={20} style={{ color: 'var(--danger)' }} weight="bold" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] leading-relaxed break-words" style={{ color: 'var(--surface-text)' }}>
                {message || 'Could not reach the server.'}
              </p>
              <p className="mt-1 text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
                GET /api/tasks/today
              </p>
            </div>
          </div>

          {/* Help explainer */}
          <div className="rounded-2xl p-4 mb-5" style={{ background: 'rgba(52,212,104,0.06)', border: '1px solid rgba(52,212,104,0.15)' }}>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--surface-text)' }}>
              <strong style={{ color: 'var(--bio-green)' }}>On local WiFi?</strong> Tap "Change Server URL" and enter your PC's local IP (e.g. <span className="font-mono" style={{ color: 'var(--bio-green)' }}>http://192.168.1.x:3001</span>).
            </p>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--surface-text)' }}>
              <strong style={{ color: 'var(--bio-green)' }}>On Tailscale?</strong> Make sure the VPN is connected and Docker is running on the host.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="btn-primary min-h-[44px] group"
            >
              <ArrowClockwise
                size={16}
                weight="regular"
                className="transition-transform duration-400 group-hover:rotate-[60deg]"
              />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => setShowUrlModal(true)}
              className="btn-ghost min-h-[44px]"
            >
              <WifiSlash size={16} weight="regular" />
              <span>Change Server URL</span>
            </button>
          </div>
        </div>
      </div>

      {showUrlModal && <ServerUrlModal onClose={() => setShowUrlModal(false)} />}
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
      className="mt-10 md:mt-12 px-3"
    >
      <div className="lab-card-accent px-6 py-14 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
          <CircleWavyCheck size={28} weight="regular" />
        </div>
        <h2 className="font-sans font-bold text-3xl md:text-4xl leading-tight tracking-tight text-balance" style={{ color: 'var(--surface-text)' }}>
          Bench is clear.
        </h2>
        <p className="mt-3 text-[14px]" style={{ color: 'var(--surface-muted)' }}>
          Nothing scheduled for today. Take a breath.
        </p>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function parseTaskDate(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10))
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function humanizeTaskStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'Pending',
    IN_PROGRESS: 'In progress',
    COMPLETE: 'Complete',
    SKIPPED: 'Skipped',
    RESCHEDULED: 'Rescheduled',
    FLAGGED: 'Flagged',
    OVER_BUDGET_WARNING: 'Over budget',
  }
  if (map[status]) return map[status]
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function StatusDot({ status }: { status: string }) {
  let bg = 'rgba(255,255,255,0.2)'
  if (status === 'PENDING')             bg = 'rgba(122, 171, 131, 0.7)'
  if (status === 'IN_PROGRESS')         bg = 'var(--warn)'
  if (status === 'OVER_BUDGET_WARNING') bg = 'var(--warn)'
  if (status === 'FLAGGED')             bg = 'var(--warn)'
  if (status === 'COMPLETE')            bg = 'var(--bio-green)'
  if (status === 'SKIPPED')             bg = 'rgba(255,255,255,0.12)'
  return <span className="h-2 w-2 rounded-full shrink-0" style={{ background: bg }} />
}
