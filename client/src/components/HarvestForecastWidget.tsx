import { useCallback, useEffect, useState } from 'react'
import { Leaf } from 'phosphor-react'
import { getHarvestForecast, type ForecastEntry } from '../lib/api'

export function HarvestForecastWidget() {
  const [forecast, setForecast] = useState<ForecastEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getHarvestForecast()
      setForecast(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forecast')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="lab-card p-4 md:p-5 min-w-0">
      <div className="flex items-center gap-3 mb-4 min-w-0">
        <div className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--amber_lab-dim)', color: 'var(--amber_lab)' }}>
          <Leaf size={18} weight="regular" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold leading-snug" style={{ color: 'var(--surface-text)' }}>
            Harvest Forecast
          </div>
          <div className="text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
            Active FRUITING batches
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-16 flex items-center justify-center text-[12px] font-mono text-surface-muted">Loading forecast...</div>
      ) : error ? (
        <div className="text-[12px] text-danger font-mono break-words">{error}</div>
      ) : forecast.length === 0 ? (
        <div className="rounded-2xl px-4 py-6 text-center text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--surface-muted)' }}>
          No active fruiting batches.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 min-w-0">
          {forecast.map((f) => (
            <div key={f.id} className="rounded-2xl p-3 min-w-0" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-start justify-between gap-2 min-w-0 mb-2">
                <div className="font-sans font-semibold text-[15px] truncate text-surface-text">
                  {f.species_name}
                </div>
                <div className="text-[10px] font-mono uppercase text-surface-muted mt-1 shrink-0">
                  {f.quantity} units
                </div>
              </div>
              <div className="flex items-end justify-between min-w-0">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] uppercase tracking-eyebrow text-surface-muted">Target</span>
                  <span className="font-mono text-[12px] text-surface-text">{f.fruiting_target_end || 'N/A'}</span>
                </div>
                {f.days_to_harvest != null && (
                  <div className={`font-mono text-[11px] font-bold ${f.days_to_harvest < 0 ? 'text-danger' : f.days_to_harvest <= 2 ? 'text-warn' : 'text-bio-green'}`}>
                    {f.days_to_harvest < 0 ? `${Math.abs(f.days_to_harvest)}d Overdue` : f.days_to_harvest === 0 ? 'Today' : `In ${f.days_to_harvest}d`}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
