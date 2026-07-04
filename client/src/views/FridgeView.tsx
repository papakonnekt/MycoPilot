// =============================================================
// Myco Lab — Fridge (Phase 3 Step 3 / Phase 5 Step 3)
//
// Mobile-overhaul changes:
//  - H1 down from text-5xl/6xl to text-4xl/6xl for mobile fit.
//  - Every bag card and gauge uses min-w-0 on text columns
//    so long species names and batch_refs can wrap or break
//    cleanly inside a flex parent.
//  - The stat tile grid drops to 2 cols on mobile (was 2/4
//    already, but gap tightened to gap-3).
//  - The expired list truncates the common_name with a
//    tooltip-friendly break-words approach (was plain truncate).
//  - Toast positioned via env(safe-area-inset-bottom) so it
//    never hides under the system gesture bar.
//  - All interactive buttons (Expire) carry min-h-[44px] for
//    touch targets.
//
// Phase 5 Step 3 hardening:
//  - EmptyBags card mirrors CalendarEmpty style with a CTA.
//  - Defensive Array.isArray / ?? [] guards on every list prop
//    from the API payload so a blank DB never throws.
//  - Top-of-page empty state if no species are configured at all
//    (we still try to render even if the inventory payload omits
//    fields), nudging the operator to the Bench or Settings.
//
// Refactor Sprint 1 — Step 4 (Barcode POC):
//  - Added a "Scan Bag" icon button to the Fridge header.
//  - Wired @capacitor/barcode-scanner v3.x: CapacitorBarcodeScanner
//    is a class with a static scanBarcode(options) method returning
//    { ScanResult: string; format: ... }. Result is logged to
//    console with the prefix `[Fridge] Scanned bag:` — no UI,
//    no item creation (proof-of-concept only).
//  - Web fallback: if Capacitor.getPlatform() === 'web', we log
//    a friendly console message and return without invoking the
//    native plugin (it would throw on the browser).
//
// Data flow:
//   1. GET /inventory → fridgeSummary (per-species aggregate)
//   2. GET /inventory/fridge → active batches + expired batches
//   3. DELETE /inventory/fridge/:id/expire — manual expire action
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
  Barcode,
  CircleNotch,
  Flask,
  Snowflake,
  Thermometer,
  Trash,
  Warning,
  WifiSlash,
} from 'phosphor-react'

import { Capacitor } from '@capacitor/core'
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner'

import {
  ApiError,
  expireFridgeEntry,
  getFridge,
  getInventory,
  type FridgeBufferRow,
  type FridgePayload,
  type FridgeSummaryRow,
  type InventoryPayload,
  type SpeciesRow,
  type BatchRow,
} from '../lib/api'
import { HelpTooltip } from '../components/HelpTooltip'
import { ServerUrlModal } from '../components/ServerUrlModal'

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

// Defensive list coercion — used at every API payload access so a blank DB
// (Phase 5 Step 3 blank-state deployment) can never cause a render crash.
function safeList<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
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

  const [isModalOpen, setIsModalOpen] = useState(false)

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
    <>
      <FridgeReady
        key={
          (state.fridge.active?.length ?? 0) +
          ':' +
          (state.fridge.active?.[0]?.id ?? 'empty') +
          ':' +
          (state.inventory.fridgeSummary?.length ?? 0)
        }
        inventory={state.inventory}
        fridge={state.fridge}
        onReload={(action) => {
          if (action === 'open-modal') setIsModalOpen(true)
          else load()
        }}
      />
      {isModalOpen && (
        <NewItemModal
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

function FridgeReady({
  inventory,
  fridge,
  onReload,
}: {
  inventory: InventoryPayload
  fridge: FridgePayload
  onReload: (action?: string) => void
}) {
  const reduceMotion = useReducedMotion()
  const [toast, setToast] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  // Defensive: never call .sort on undefined. A blank DB returns an empty
  // array, but intermediate fetches or partial payloads could omit fields.
  const summaries = useMemo(() => {
    const list = safeList<FridgeSummaryRow>(inventory.fridgeSummary)
    return [...list].sort((a, b) => {
      const aBelow = num(a, 'below_threshold') ? 1 : 0
      const bBelow = num(b, 'below_threshold') ? 1 : 0
      if (aBelow !== bBelow) return bBelow - aBelow
      return (a.common_name ?? '').localeCompare(b.common_name ?? '')
    })
  }, [inventory.fridgeSummary])

  const activeBags = safeList<FridgeBufferRow>(fridge.active)
  const expiredBags = safeList<FridgeBufferRow>(fridge.expired)
  const totalActive = activeBags.length
  const totalExpired = expiredBags.length
  const belowCount = summaries.filter((s) => num(s, 'below_threshold')).length
  const oldestDays = activeBags.reduce<number | null>((acc, b) => {
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

  // Refactor Sprint 1 — Step 4 (Barcode POC)
  // Opens the native barcode scanner via @capacitor/barcode-scanner v3.x.
  // On web we log a friendly message and bail. On Android, the raw
  // { ScanResult, format } payload is logged with a clear `[Fridge]`
  // prefix so the developer can see it in chrome://inspect. No item is
  // created from the scan — that wiring is a future step.
  const handleScan = useCallback(async () => {
    if (isScanning) return
    if (Capacitor.getPlatform() === 'web') {
      // eslint-disable-next-line no-console
      console.log('Barcode scanner not available on web — proof-of-concept only.')
      return
    }
    setIsScanning(true)
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.ALL,
      })
      // eslint-disable-next-line no-console
      console.log('[Fridge] Scanned bag:', result)
      if (result && typeof result.ScanResult === 'string') {
        // eslint-disable-next-line no-console
        console.log('[Fridge] Scanned bag ScanResult:', result.ScanResult)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Fridge] Barcode scan failed:', err)
    } finally {
      setIsScanning(false)
    }
  }, [isScanning])

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
              <span className="eyebrow-tag">Fridge</span>
              <span
                className="text-[10px] uppercase tracking-eyebrow"
                style={{ color: 'var(--surface-muted)' }}
              >
                Step 4 · Cold Storage
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleScan}
                disabled={isScanning}
                aria-label="Scan bag barcode"
                title="Scan bag"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-full font-semibold text-sm transition-transform duration-200 active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--surface-text)',
                }}
              >
                <Barcode size={18} weight="regular" />
                <span className="ml-1.5 hidden sm:inline">Scan Bag</span>
              </button>
              <button
                onClick={() => onReload('open-modal')}
                className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-full font-semibold text-sm transition-transform duration-200 active:scale-95"
                style={{ background: 'var(--bio-green)', color: 'var(--surface-900)' }}
              >
                + New Item
              </button>
            </div>
          </div>
          <h1
            className="font-sans font-bold text-4xl md:text-6xl leading-[0.95] tracking-tight text-balance break-words"
            style={{ color: 'var(--surface-text)' }}
          >
            Gen 2 buffer.
          </h1>
          <p
            className="mt-3 max-w-xl text-[15px] leading-relaxed"
            style={{ color: 'var(--surface-muted)' }}
          >
            Spawned-grain inventory for next-week inoculations. Bags expire after
            90 days; the gauge turns amber as you cross min and brick below it.
          </p>
        </div>

        {/* Stat row — 2 cols on mobile, 4 on md+. */}
        <div className="mt-6 md:mt-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Active bags
                <HelpTooltip title="Active Bags" text="The total number of unexpired spawn bags currently stored in the fridge buffer." />
              </span>
            }
            value={String(totalActive).padStart(2, '0')}
            icon={<Snowflake size={16} weight="regular" />}
          />
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Below min
                <HelpTooltip title="Below Minimum Threshold" text="The number of species whose active spawn bag count has fallen below the configured minimum." />
              </span>
            }
            value={String(belowCount).padStart(2, '0')}
            tone={belowCount > 0 ? 'brick' : 'ink'}
          />
          <StatTile
            label={
              <span className="flex items-center gap-1">
                Soonest expiry
                <HelpTooltip title="Soonest Expiry" text="The number of days until the oldest active spawn bag in the fridge expires (90-day shelf life)." />
              </span>
            }
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
            label={
              <span className="flex items-center gap-1">
                Expired (inactive)
                <HelpTooltip title="Expired Bags" text="The total number of spawn bags that have passed their 90-day shelf life and should be discarded." />
              </span>
            }
            value={String(totalExpired).padStart(2, '0')}
            tone={totalExpired > 0 ? 'amber' : 'ink'}
          />
        </div>

        {/* Two-column bento: gauges left, bag grid right */}
        <div className="mt-6 md:mt-8 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4">
          <section className="md:col-span-5 min-w-0">
            <div className="lab-card p-4 md:p-6">
              <span className="eyebrow-tag">
                Stock gauges
                <HelpTooltip
                  title="Stock Gauges"
                  text="Net-available bags per species vs. your configured minimum and target thresholds. Red = below minimum, amber = below target."
                />
              </span>
              <h2
                className="mt-3 font-sans font-bold text-2xl md:text-3xl leading-[1.05] tracking-tight text-balance"
                style={{ color: 'var(--surface-text)' }}
              >
                Species buffer
              </h2>
              <p
                className="text-[13px] mt-1 mb-5"
                style={{ color: 'var(--surface-muted)' }}
              >
                Current net-available bags vs. min and target thresholds.
              </p>

              {summaries.length === 0 ? (
                <div
                  className="rounded-2xl px-4 py-6 text-center text-[13px]"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--surface-muted)',
                  }}
                >
                  No species configured yet. Add one in Settings to start tracking a buffer.
                </div>
              ) : (
                <div className="space-y-5">
                  {summaries.map((s) => (
                    <Gauge key={s.species_id} row={s} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="md:col-span-7 min-w-0">
            <div className="lab-card p-4 md:p-6">
              <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
                <div className="min-w-0">
                  <span className="eyebrow-tag">
                    Active bags
                  </span>
                  <h2
                    className="mt-3 font-sans font-bold text-2xl md:text-3xl leading-[1.05] tracking-tight text-balance"
                    style={{ color: 'var(--surface-text)' }}
                  >
                    Bag grid
                  </h2>
                </div>
              </div>
              <p
                className="text-[13px] mt-1 mb-5"
                style={{ color: 'var(--surface-muted)' }}
              >
                Days-remaining counts down from 90. Manually expire any
                bag that's gone off.
              </p>

              {activeBags.length === 0 ? (
                <EmptyBags onOpenModal={() => onReload('open-modal')} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <AnimatePresence initial={false}>
                    {activeBags.map((b, i) => (
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

              {expiredBags.length > 0 && (
                <div
                  className="mt-6 pt-5"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <span className="eyebrow-tag !bg-[#B23A2A]/10 !text-[#B23A2A]">
                    Expired (audit)
                  </span>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {expiredBags.slice(0, 6).map((b) => (
                      <div
                        key={b.id}
                        className="rounded-2xl px-3 py-2 text-[12px] flex items-center justify-between gap-2 min-w-0"
                        style={{
                          border: '1px solid rgba(178,58,42,0.2)',
                          background: 'rgba(178,58,42,0.04)',
                          color: 'var(--surface-muted)',
                        }}
                      >
                        <span className="break-words min-w-0 flex-1">
                          {b.common_name}
                        </span>
                        <span
                          className="font-mono text-num shrink-0 whitespace-nowrap"
                          style={{ color: 'var(--surface-muted)' }}
                        >
                          {formatDateShort(b.date_expires)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <div
          className="mt-10 md:mt-12 flex items-center gap-2 text-[11px] uppercase tracking-eyebrow"
          style={{ color: 'var(--surface-muted)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--bio-green)' }} />
          <span>End of fridge</span>
        </div>
      </motion.div>

      {/* Toast — sits above the bottom nav + system gesture bar. */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="fixed left-1/2 -translate-x-1/2 z-50 px-4"
            style={{
              bottom:
                'calc(env(safe-area-inset-bottom, 0px) + 5.5rem + 0.75rem)',
            }}
            role="status"
          >
            <div
              className="lab-card px-4 py-3 flex items-center gap-2 text-sm max-w-[min(92vw,32rem)]"
              style={{ color: 'var(--surface-text)' }}
            >
              <Warning size={18} weight="regular" className="shrink-0" style={{ color: 'var(--warn)' }} />
              <span className="break-words min-w-0">{toast}</span>
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
  label: React.ReactNode | string
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
// GAUGE
// ─────────────────────────────────────────────────────────────

function Gauge({ row }: { row: FridgeSummaryRow }) {
  const reduceMotion = useReducedMotion()
  const current = num(row, 'net_available') ?? 0
  const min = num(row, 'min_gen2_bags') ?? 2
  const target = num(row, 'target_gen2_bags') ?? 5

  const barMax = Math.max(target * 1.2, current, 1)

  const minPct = Math.min(100, (min / barMax) * 100)
  const targetPct = Math.min(100, (target / barMax) * 100)
  const currentPct = Math.min(100, (current / barMax) * 100)

  const belowMin = current < min
  const fillTone = belowMin ? '#B23A2A' : current < target ? '#B97A1F' : '#1F3D2B'

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
    <div className="min-w-0">
      <div className="flex items-baseline justify-between mb-1.5 gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div
            className="font-medium text-[15px] leading-tight break-words"
            style={{ color: 'var(--surface-text)' }}
          >
            {row.common_name}
          </div>
          <div
            className="text-[11px] font-mono uppercase tracking-eyebrow"
            style={{ color: 'var(--surface-muted)' }}
          >
            min {min} · target {target}
            <HelpTooltip
              title="Min & Target Thresholds"
              text="Min = minimum bags needed to keep inoculations running without a gap. Target = ideal buffer to absorb contamination losses."
            />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className="font-sans font-bold text-2xl leading-none text-num"
            style={{ color: 'var(--surface-text)' }}
          >
            {current}
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-eyebrow mt-0.5"
            style={{ color: 'var(--surface-muted)' }}
          >
            bags
          </div>
        </div>
      </div>

      <div
        className="relative h-2 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <div
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{ width: `${targetPct}%`, background: 'rgba(185,122,31,0.15)' }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{ width: `${minPct}%`, background: 'rgba(178,58,42,0.15)' }}
        />
        <motion.div
          style={{ width: widthPct, backgroundColor: fillTone }}
          className="relative h-full"
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-px"
          style={{ left: `${minPct}%`, background: 'rgba(255,255,255,0.4)' }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-px"
          style={{ left: `${targetPct}%`, background: 'rgba(255,255,255,0.3)' }}
        />
      </div>

      <div
        className="mt-1.5 flex items-center justify-between text-[10px] uppercase tracking-eyebrow font-mono"
        style={{ color: 'var(--surface-muted)' }}
      >
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
      : 'bg-bio-green/10 text-bio-green'

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
        className="rounded-2xl p-4 transition-all duration-450 ease-fluid min-w-0"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: status.tone === 'critical'
            ? '1px solid rgba(178,58,42,0.3)'
            : '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div
              className="font-medium text-[15px] leading-tight break-words"
              style={{ color: 'var(--surface-text)' }}
            >
              {row.common_name ?? 'Species'}
            </div>
            <div
              className="font-mono text-[11px] uppercase tracking-eyebrow mt-0.5 break-all"
              style={{ color: 'var(--surface-muted)' }}
            >
              {row.batch_ref ?? `bag #${row.id}`}
            </div>
          </div>
          <span
            className={
              'shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-eyebrow font-medium whitespace-nowrap ' +
              toneClass
            }
          >
            {status.label}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <div>
            <div
              className="font-sans font-bold text-2xl md:text-3xl leading-none text-num"
              style={{ color: 'var(--surface-text)' }}
            >
              {days != null ? days : '—'}
            </div>
            <div
              className="text-[10px] uppercase tracking-eyebrow font-mono mt-1"
              style={{ color: 'var(--surface-muted)' }}
            >
              days left
            </div>
          </div>
          <div
            className="text-right text-[11px] leading-tight min-w-0"
            style={{ color: 'var(--surface-muted)' }}
          >
            <>
              <span
                className="uppercase tracking-eyebrow"
                style={{ color: 'var(--surface-muted)' }}
              >
                Added
              </span>{' '}
              <span className="font-mono text-num whitespace-nowrap">{addedDate}</span>
            </>
            <div className="mt-0.5">
              <span
                className="uppercase tracking-eyebrow"
                style={{ color: 'var(--surface-muted)' }}
              >
                Expires
              </span>{' '}
              <span className="font-mono text-num whitespace-nowrap">{expiresDate}</span>
            </div>
          </div>
        </div>

        <div
          className="mt-3 pt-3 flex items-center justify-between gap-2 min-w-0"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="text-[10px] uppercase tracking-eyebrow font-mono whitespace-nowrap"
            style={{ color: 'var(--surface-muted)' }}
          >
            qty {row.quantity_available}
            {row.reserved_quantity > 0 && (
              <span className="ml-1" style={{ color: 'var(--warn)' }}>
                · {row.reserved_quantity} reserved
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onExpire}
            disabled={busy}
            className="group min-h-[44px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all duration-450 ease-fluid active:scale-[0.97]"
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--surface-muted)',
            }}
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
// EMPTY — Phase 5 Step 3 hardened to mirror CalendarEmpty
// ─────────────────────────────────────────────────────────────

// Phase 5 Step 3: hardened empty-state card. Mirrors the CalendarEmpty card
// style from WeeklyCalendar (icon, headline, body, primary CTA). Added a
// Settings + New Item CTA pair so the operator can route themselves out of
// the blank state.
function EmptyBags({ onOpenModal }: { onOpenModal?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      className="rounded-2xl px-6 py-10 text-center"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        className="mx-auto mb-4 h-12 w-12 rounded-full flex items-center justify-center"
        style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}
      >
        <Snowflake size={24} weight="regular" />
      </div>
      <h3
        className="font-sans font-bold text-2xl leading-tight text-balance"
        style={{ color: 'var(--surface-text)' }}
      >
        No cultures in your fridge.
      </h3>
      <p
        className="mt-2 text-[13px] max-w-sm mx-auto"
        style={{ color: 'var(--surface-muted)' }}
      >
        Add a storage batch from the Bench &mdash; move a colonized Gen 2 bag
        into cold storage and the 90-day clock starts ticking.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onOpenModal}
          className="min-h-[44px] group inline-flex items-center gap-2 btn-primary"
          aria-label="Add a new fridge item"
        >
          <Flask size={16} weight="regular" />
          <span>New Fridge Item</span>
        </button>
        <a
          href="/settings"
          className="min-h-[44px] inline-flex items-center gap-2 btn-ghost"
          aria-label="Go to Settings"
        >
          Go to Settings
        </a>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// SKELETON + ERROR
// ─────────────────────────────────────────────────────────────

function FridgeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag opacity-60">Fridge</span>
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
      <div className="mt-8 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4">
        <div className="md:col-span-5 lab-card p-4 md:p-5 space-y-5">
          <div className="h-7 w-1/2 rounded-full skeleton" />
          <div className="h-2 w-full rounded-full skeleton" />
          <div className="h-2 w-full rounded-full skeleton" />
          <div className="h-2 w-full rounded-full skeleton" />
        </div>
        <div className="md:col-span-7 lab-card p-4 md:p-5">
          <div className="h-7 w-1/3 rounded-full skeleton mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 rounded-2xl skeleton" />
            ))}
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
  const [showUrlModal, setShowUrlModal] = useState(false)
  return (
    <div className="mx-auto w-full max-w-3xl min-w-0">
      <div className="pt-2">
        <span className="eyebrow-tag">Fridge</span>
        <h1
          className="mt-4 md:mt-5 font-sans font-bold text-4xl md:text-6xl leading-[0.95] tracking-tight text-balance break-words"
          style={{ color: 'var(--surface-text)' }}
        >
          Fridge unreachable
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
                GET /api/inventory · GET /api/inventory/fridge
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
// NEW ITEM MODAL
// ─────────────────────────────────────────────────────────────

function NewItemModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [speciesList, setSpeciesList] = useState<SpeciesRow[]>([])
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [speciesId, setSpeciesId] = useState<number | ''>('')
  const [batchId, setBatchId] = useState<number | ''>('')
  const [quantity, setQuantity] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      import('../lib/api').then(m => m.getSpecies()),
      import('../lib/api').then(m => m.getBatches()),
    ]).then(([s, b]) => {
      const safeSpecies = Array.isArray(s) ? s : []
      const safeBatches = Array.isArray(b) ? b : []
      setSpeciesList(safeSpecies)
      setBatches(safeBatches.filter(batch =>
        (batch.stage === 'GEN1_GRAIN' || batch.stage === 'GEN2_GRAIN' || batch.stage === 'GEN3_GRAIN' || batch.stage === 'BULK_BLOCK') &&
        batch.pct_complete === 100
      ))
      if (safeSpecies.length > 0) setSpeciesId(safeSpecies[0].id)
    }).catch(err => console.error(err))
  }, [])

  const filteredBatches = useMemo(() => {
    if (!speciesId) return []
    return batches.filter(b => b.species_id === speciesId)
  }, [speciesId, batches])

  useEffect(() => {
    if (filteredBatches.length > 0) {
      setBatchId(filteredBatches[0].id)
    } else {
      setBatchId('')
    }
  }, [filteredBatches])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!speciesId || !batchId) return
    setIsSubmitting(true)
    setError(null)
    try {
      const { addFridgeItem } = await import('../lib/api')
      const expires = new Date()
      expires.setDate(expires.getDate() + 90)

      await addFridgeItem({
        species_id: Number(speciesId),
        batch_id: Number(batchId),
        date_placed: new Date().toISOString().split('T')[0],
        date_expires: expires.toISOString().split('T')[0],
        quantity_available: quantity,
      })
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to add item')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade_in">
      <div className="w-full max-w-md bg-surface-900 border border-surface-border rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-surface-border">
          <h2 className="font-semibold text-lg" style={{ color: 'var(--surface-text)' }}>New Fridge Item</h2>
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
            <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Source Batch</label>
            <select
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors"
              value={batchId}
              onChange={(e) => setBatchId(Number(e.target.value) || '')}
              required
            >
              {filteredBatches.length === 0 && <option value="">No active batches found</option>}
              {filteredBatches.map(b => (
                <option key={b.id} value={b.id}>{b.stage} (ID: {b.id})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--surface-muted)' }}>
              Quantity Available
            </label>
            <input
              type="number"
              min="1"
              required
              className="w-full bg-surface-800 border border-surface-border rounded-lg px-3 py-2 text-surface-text outline-none focus:border-bio-green transition-colors"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
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
              disabled={isSubmitting || !speciesId || !batchId}
              className="flex-1 py-2.5 rounded-full font-semibold text-sm bg-bio-green text-surface-900 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Adding...' : 'Add to Fridge'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
