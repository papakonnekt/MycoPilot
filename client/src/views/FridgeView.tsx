// =============================================================
// Myco Lab — Fridge (Phase 3 Step 3)
//
// Gen 2 spawn inventory dashboard. Shows current stock vs
// min/target thresholds, days-remaining on each batch, and a
// horizontal gauge per species. Two-column desktop layout:
// gauges left, bag grid right.
//
// Data flow:
//   1. GET /inventory → fridgeSummary (per-species aggregate)
//   2. GET /inventory/fridge → active batches + expired batches
//   3. DELETE /inventory/fridge/:id/expire — manual expire action
//
// Design system: bezel-shell/core, eyebrow-tag, Instrument Serif H1,
// framer-motion fade/slide, moss/amber/[#B23A2A] palette per spec.
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
  CircleNotch,
  Snowflake,
  Thermometer,
  Trash,
  Warning,
} from 'phosphor-react'

import {
  ApiError,
  expireFridgeEntry,
  getFridge,
  getInventory,
  type FridgeBufferRow,
  type FridgePayload,
  type FridgeSummaryRow,
  type InventoryPayload,
} from '../lib/api'

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface FetchState {
  inventory: InventoryPayload | null
  fridge: FridgePayload | null
  loading: boolean
  error: string | null
}

interface BagStatus {
  tone: 'fresh' | 'aging' | 'critical'
  label: string
}

function statusForDays(days: number | null | undefined): BagStatus {
  if (days == null) return { tone: 'fresh', label: 'Fresh' }
  if (days <= 14) return { tone: 'critical', label: 'Critical' }
  if (days <= 30) return { tone: 'aging', label: 'Aging' }
  return { tone: 'fresh', label: 'Fresh' }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  // Handle "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
  const datePart = s.split(' ')[0] ?? s
  const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function formatDateShort(s: string | null | undefined): string {
  const d = parseDate(s)
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function num(row: FridgeSummaryRow | null | undefined, key: keyof FridgeSummaryRow): number | null {
  if (!row) return null
  const v = row[key]
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : null
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null

export default function FridgeView() {
  const [state, setState] = useState<FetchState>({
    inventory: null,
    fridge: null,
    loading: true,
    error: null,
  })

  const load = useCallback(async (): Promise<void> => {
    if (loadInFlight) return loadInFlight
    setState((s) => ({ ...s, loading: true, error: null }))
    const work = (async () => {
      try {
        const [inv, fr] = await Promise.all([getInventory(), getFridge()])
        setState({ inventory: inv, fridge: fr, loading: false, error: null })
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Could not reach the fridge.'
        setState({
          inventory: null,
          fridge: null,
          loading: false,
          error: message,
        })
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

  if (state.loading) return <FridgeSkeleton />
  if (state.error) {
    return <FridgeError message={state.error} onRetry={load} />
  }
  if (!state.inventory || !state.fridge) {
    return <FridgeError message="No payload" onRetry={load} />
  }

  return (
    <FridgeReady
      key={
        state.fridge.active.length +
        ':' +
        (state.fridge.active[0]?.id ?? 'empty') +
        ':' +
        state.inventory.fridgeSummary.length
      }
      inventory={state.inventory}
      fridge={state.fridge}
      onReload={load}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────

function FridgeReady({
  inventory,
  fridge,
  onReload,
}: {
  inventory: InventoryPayload
  fridge: FridgePayload
  onReload: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [toast, setToast] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const summaries = useMemo(() => {
    return [...inventory.fridgeSummary].sort((a, b) => {
      const aBelow = num(a, 'below_threshold') ? 1 : 0
      const bBelow = num(b, 'below_threshold') ? 1 : 0
      if (aBelow !== bBelow) return bBelow - aBelow
      return (a.common_name ?? '').localeCompare(b.common_name ?? '')
    })
  }, [inventory.fridgeSummary])

  const totalActive = fridge.active.length
  const totalExpired = fridge.expired.length
  const belowCount = summaries.filter((s) => num(s, 'below_threshold')).length
  const oldestDays = fridge.active.reduce<number | null>((acc, b) => {
    const d = b.days_until_expiry
    if (d == null) return acc
    return acc == null ? d : Math.min(acc, d)
  }, null)

  const handleExpire = useCallback(
    async (id: number) => {
      if (busyId != null) return
      setBusyId(id)
      try {
        await expireFridgeEntry(id)
        onReload()
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Could not expire bag.'
        setToast(message)
        window.setTimeout(() => setToast(null), 3500)
      } finally {
        setBusyId(null)
      }
    },
    [busyId, onReload],
  )

  return (
    <div className="relative">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto w-full max-w-6xl"
      >
        {/* Header */}
        <div className="pt-2">
          <div className="flex items-center gap-3">
            <span className="eyebrow-tag">Fridge</span>
            <span className="text-[10px] uppercase tracking-eyebrow text-ink/40">
              Step 4 · Cold Storage
            </span>
          </div>
          <h1 className="mt-5 font-serif text-5xl md:text-6xl leading-[0.95] tracking-tight text-ink">
            Gen 2 buffer.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-graphite-500">
            Spawned-grain inventory for next-week inoculations. Bags expire after
            90 days; the gauge turns amber as you cross min and brick below it.
          </p>
        </div>

        {/* Stat row */}
        <div className="mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Active bags"
            value={String(totalActive).padStart(2, '0')}
            icon={<Snowflake size={16} weight="regular" />}
          />
          <StatTile
            label="Below min"
            value={String(belowCount).padStart(2, '0')}
            tone={belowCount > 0 ? 'brick' : 'ink'}
          />
          <StatTile
            label="Soonest expiry"
            value={
              oldestDays != null
                ? `${oldestDays}d`
                : '—'
            }
            tone={
              oldestDays == null
                ? 'ink'
                : oldestDays <= 14
                ? 'brick'
                : oldestDays <= 30
                ? 'amber'
                : 'ink'
            }
            icon={<Thermometer size={16} weight="regular" />}
          />
          <StatTile
            label="Expired (inactive)"
            value={String(totalExpired).padStart(2, '0')}
            tone={totalExpired > 0 ? 'amber' : 'ink'}
          />
        </div>

        {/* Two-column bento: gauges left, bag grid right */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-4">
          <section className="md:col-span-5">
            <div className="bezel-shell">
              <div className="bezel-core p-5 md:p-6">
                <span className="eyebrow-tag">Stock gauges</span>
                <h2 className="mt-3 font-serif text-3xl leading-[1.05] tracking-tight text-ink">
                  Species buffer
                </h2>
                <p className="text-[13px] text-graphite-500 mt-1 mb-5">
                  Current net-available bags vs. min and target thresholds.
                </p>

                {summaries.length === 0 ? (
                  <div className="rounded-2xl bg-black/[0.025] ring-1 ring-black/5 px-4 py-6 text-center text-[13px] text-graphite-500">
                    No species configured yet.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {summaries.map((s) => (
                      <Gauge key={s.species_id} row={s} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="md:col-span-7">
            <div className="bezel-shell">
              <div className="bezel-core p-5 md:p-6">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div>
                    <span className="eyebrow-tag !bg-ink/[0.06] !text-ink">
                      Active bags
                    </span>
                    <h2 className="mt-3 font-serif text-3xl leading-[1.05] tracking-tight text-ink">
                      Bag grid
                    </h2>
                  </div>
                </div>
                <p className="text-[13px] text-graphite-500 mt-1 mb-5">
                  Days-remaining counts down from 90. Manually expire any
                  bag that's gone off.
                </p>

                {fridge.active.length === 0 ? (
                  <EmptyBags />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <AnimatePresence initial={false}>
                      {fridge.active.map((b, i) => (
                        <BagCard
                          key={b.id}
                          row={b}
                          entryDelayMs={Math.min(i * 60, 360)}
                          busy={busyId === b.id}
                          onExpire={() => handleExpire(b.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                {fridge.expired.length > 0 && (
                  <div className="mt-6 pt-5 border-t border-ink/[0.06]">
                    <span className="eyebrow-tag !bg-[#B23A2A]/10 !text-[#B23A2A]">
                      Expired (audit)
                    </span>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {fridge.expired.slice(0, 6).map((b) => (
                        <div
                          key={b.id}
                          className="rounded-2xl ring-1 ring-[#B23A2A]/20 bg-[#B23A2A]/[0.04] px-3 py-2 text-[12px] text-ink/70 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{b.common_name}</span>
                          <span className="font-mono text-num text-ink/50">
                            {formatDateShort(b.date_expires)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow text-ink/40">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-700" />
          <span>End of fridge</span>
        </div>
      </motion.div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="fixed left-1/2 -translate-x-1/2 bottom-28 z-50 px-4"
            role="status"
          >
            <div className="bezel-shell">
              <div className="bezel-core px-4 py-3 flex items-center gap-2 text-sm text-ink">
                <Warning size={18} weight="regular" className="text-amber_lab" />
                <span>{toast}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
      <div className="bezel-core px-4 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-eyebrow text-ink/40 font-medium">
            {label}
          </span>
          {icon && <span className="text-ink/30">{icon}</span>}
        </div>
        <div
          className={
            'font-serif text-3xl md:text-4xl leading-none text-num ' + valueColor
          }
        >
          {value}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// GAUGE
// ─────────────────────────────────────────────────────────────

function Gauge({ row }: { row: FridgeSummaryRow }) {
  const reduceMotion = useReducedMotion()
  const current = num(row, 'net_available') ?? 0
  const min = num(row, 'min_gen2_bags') ?? 2
  const target = num(row, 'target_gen2_bags') ?? 5

  // Bar fills up to "max( target * 1.2, current )" so we always show
  // context. Three zones:
  //   0 .. min   : brick (below minimum)
  //   min .. target : amber (warming up)
  //   target .. max : moss (healthy)
  const barMax = Math.max(target * 1.2, current, 1)

  // Build fill segments as percentages of the bar.
  const minPct = Math.min(100, (min / barMax) * 100)
  const targetPct = Math.min(100, (target / barMax) * 100)
  const currentPct = Math.min(100, (current / barMax) * 100)

  const belowMin = current < min
  const fillTone = belowMin ? '#B23A2A' : current < target ? '#B97A1F' : '#1F3D2B'

  // Animate the fill width on mount via framer-motion's animate().
  const mv = useMotionValue(0)
  const widthPct = useTransform(mv, (v) => `${v}%`)
  useEffect(() => {
    if (reduceMotion) {
      mv.set(currentPct)
      return
    }
    const controls = animate(mv, currentPct, {
      duration: 1.1,
      ease: [0.32, 0.72, 0, 1],
    })
    return () => controls.stop()
  }, [currentPct, mv, reduceMotion])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="min-w-0">
          <div className="font-medium text-ink truncate text-[15px] leading-tight">
            {row.common_name}
          </div>
          <div className="text-[11px] text-ink/40 font-mono uppercase tracking-eyebrow">
            min {min} · target {target}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-serif text-2xl leading-none text-num text-ink">
            {current}
          </div>
          <div className="text-[10px] text-ink/40 font-mono uppercase tracking-eyebrow mt-0.5">
            bags
          </div>
        </div>
      </div>

      <div className="relative h-2 rounded-full bg-ink/[0.06] overflow-hidden">
        {/* amber zone from min to target */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 bg-amber_lab/15"
          style={{ width: `${targetPct}%` }}
        />
        {/* brick zone under min */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 bg-[#B23A2A]/15"
          style={{ width: `${minPct}%` }}
        />
        {/* fill */}
        <motion.div
          style={{ width: widthPct, backgroundColor: fillTone }}
          className="relative h-full"
        />
        {/* min tick */}
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-ink/40"
          style={{ left: `${minPct}%` }}
        />
        {/* target tick */}
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-ink/30"
          style={{ left: `${targetPct}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono">
        <span>0</span>
        <span>min {min}</span>
        <span>target {target}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// BAG CARD
// ─────────────────────────────────────────────────────────────

function BagCard({
  row,
  entryDelayMs,
  busy,
  onExpire,
}: {
  row: FridgeBufferRow
  entryDelayMs: number
  busy: boolean
  onExpire: () => void
}) {
  const reduceMotion = useReducedMotion()
  const status = statusForDays(row.days_until_expiry)
  const toneClass =
    status.tone === 'critical'
      ? 'bg-[#B23A2A]/10 text-[#B23A2A]'
      : status.tone === 'aging'
      ? 'bg-amber_lab/15 text-amber_lab'
      : 'bg-moss-700/10 text-moss-700'

  const days = row.days_until_expiry ?? null
  const addedDate = formatDateShort(row.date_added)
  const expiresDate = formatDateShort(row.date_expires)

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
      transition={{
        duration: 0.45,
        ease: [0.32, 0.72, 0, 1],
        delay: entryDelayMs / 1000,
      }}
    >
      <div
        className={
          'rounded-2xl ring-1 bg-paper p-4 transition-all duration-450 ease-fluid ' +
          (status.tone === 'critical'
            ? 'ring-[#B23A2A]/30 hover:ring-[#B23A2A]/50'
            : 'ring-ink/[0.07] hover:ring-ink/[0.15]')
        }
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="font-medium text-ink truncate text-[15px] leading-tight">
              {row.common_name ?? 'Species'}
            </div>
            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-ink/40 mt-0.5">
              {row.batch_ref ?? `bag #${row.id}`}
            </div>
          </div>
          <span
            className={
              'shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-eyebrow font-medium ' +
              toneClass
            }
          >
            {status.label}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-serif text-3xl leading-none text-num text-ink">
              {days != null ? days : '—'}
            </div>
            <div className="text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono mt-1">
              days left
            </div>
          </div>
          <div className="text-right text-[11px] text-graphite-500 leading-tight">
            <div>
              <span className="uppercase tracking-eyebrow text-ink/30">
                Added
              </span>{' '}
              <span className="font-mono text-num text-ink/60">{addedDate}</span>
            </div>
            <div className="mt-0.5">
              <span className="uppercase tracking-eyebrow text-ink/30">
                Expires
              </span>{' '}
              <span className="font-mono text-num text-ink/60">{expiresDate}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-ink/[0.06] flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-eyebrow text-ink/40 font-mono">
            qty {row.quantity_available}
            {row.reserved_quantity > 0 && (
              <span className="ml-1 text-amber_lab">
                · {row.reserved_quantity} reserved
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onExpire}
            disabled={busy}
            className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ring-1 ring-ink/10 text-ink/60 hover:ring-[#B23A2A]/40 hover:text-[#B23A2A] transition-all duration-450 ease-fluid active:scale-[0.97]"
          >
            {busy ? (
              <CircleNotch size={11} weight="regular" className="animate-spin" />
            ) : (
              <Trash size={11} weight="regular" />
            )}
            <span>{busy ? 'Expiring…' : 'Expire'}</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// EMPTY
// ─────────────────────────────────────────────────────────────

function EmptyBags() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      className="rounded-2xl bg-black/[0.025] ring-1 ring-black/5 px-6 py-10 text-center"
    >
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-moss-700/10 text-moss-700 flex items-center justify-center">
        <Snowflake size={24} weight="regular" />
      </div>
      <h3 className="font-serif text-2xl text-ink leading-tight">
        Fridge is empty.
      </h3>
      <p className="mt-2 text-[13px] text-graphite-500 max-w-sm mx-auto">
        Move a colonized Gen 2 batch to the fridge to start the 90-day clock.
      </p>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON + ERROR
// ─────────────────────────────────────────────────────────────

function FridgeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="pt-2">
        <span className="eyebrow-tag opacity-60">Fridge</span>
        <div className="mt-5 h-12 w-2/3 rounded-2xl bg-ink/[0.06] animate-pulse" />
      </div>
      <div className="mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bezel-shell">
            <div className="bezel-core px-4 py-4">
              <div className="h-2 w-16 rounded-full bg-ink/[0.06] animate-pulse" />
              <div className="mt-3 h-8 w-12 rounded-full bg-ink/[0.07] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-5 bezel-shell">
          <div className="bezel-core p-5 space-y-5">
            <div className="h-8 w-1/2 rounded-full bg-ink/[0.06] animate-pulse" />
            <div className="h-2 w-full rounded-full bg-ink/[0.05] animate-pulse" />
            <div className="h-2 w-full rounded-full bg-ink/[0.05] animate-pulse" />
            <div className="h-2 w-full rounded-full bg-ink/[0.05] animate-pulse" />
          </div>
        </div>
        <div className="md:col-span-7 bezel-shell">
          <div className="bezel-core p-5">
            <div className="h-8 w-1/3 rounded-full bg-ink/[0.06] animate-pulse mb-4" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-32 rounded-2xl bg-ink/[0.05] animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FridgeError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="pt-2">
        <span className="eyebrow-tag">Fridge</span>
        <h1 className="mt-5 font-serif text-5xl md:text-6xl leading-[0.95] tracking-tight text-ink">
          Fridge unreachable
        </h1>
      </div>
      <div className="mt-8">
        <div className="bezel-shell">
          <div className="bezel-core p-6">
            <div className="flex items-start gap-3">
              <Warning
                size={22}
                weight="regular"
                className="text-amber_lab shrink-0 mt-0.5"
              />
              <div>
                <p className="text-[15px] text-ink leading-relaxed">{message}</p>
                <p className="mt-1 text-[12px] text-ink/50 font-mono">
                  GET /api/inventory · GET /api/inventory/fridge
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
