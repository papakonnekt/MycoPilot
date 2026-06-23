import { useCallback, useEffect, useState } from 'react'
import { ThermometerHot } from 'phosphor-react'
import { getPcRunAnalytics, type PcRunAnalyticsRow } from '../lib/api'

export function PcRunHistoryWidget() {
  const [data, setData] = useState<PcRunAnalyticsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const rows = await getPcRunAnalytics()
      setData(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PC run analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="lab-card p-4 md:p-5 min-w-0 mt-6 md:mt-8">
      <div className="flex items-center gap-3 mb-4 min-w-0">
        <div className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>
          <ThermometerHot size={18} weight="regular" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug" style={{ color: 'var(--surface-text)' }}>
            PC Run History & Contamination
          </div>
          <div className="text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
            Recent 20 completed runs
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-16 flex items-center justify-center text-[12px] font-mono text-surface-muted">Loading PC run history...</div>
      ) : error ? (
        <div className="text-[12px] text-danger font-mono break-words">{error}</div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl px-4 py-6 text-center text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--surface-muted)' }}>
          No completed PC runs yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[400px]">
            <thead>
              <tr className="border-b border-surface-800">
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal">Date</th>
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal">Type</th>
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal text-right">Bags</th>
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal text-right">Contam Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-surface-800/30 transition-colors">
                  <td className="py-2.5 px-3 text-[13px] font-mono text-surface-text whitespace-nowrap">
                    {new Date(row.run_date).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-3 text-[11px] font-mono uppercase tracking-eyebrow text-surface-muted">
                    {row.run_type}
                  </td>
                  <td className="py-2.5 px-3 text-[13px] font-mono text-surface-muted text-right">
                    {row.bag_count}
                  </td>
                  <td className="py-2.5 px-3 text-[13px] font-mono text-right font-medium">
                    {row.contam_rate > 0 ? (
                      <span className={row.contam_rate > 0.1 ? 'text-danger' : 'text-warn'}>
                        {(row.contam_rate * 100).toFixed(1)}% ({row.contam_count})
                      </span>
                    ) : (
                      <span className="text-bio-green">0%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
