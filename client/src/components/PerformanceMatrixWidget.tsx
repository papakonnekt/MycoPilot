import { useCallback, useEffect, useState } from 'react'
import { ChartBar } from 'phosphor-react'
import { getPerformanceMatrix, type PerformanceMatrixRow } from '../lib/api'

export function PerformanceMatrixWidget() {
  const [data, setData] = useState<PerformanceMatrixRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const matrix = await getPerformanceMatrix()
      setData(matrix)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance matrix')
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
        <div className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
          <ChartBar size={18} weight="regular" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug" style={{ color: 'var(--surface-text)' }}>
            Substrate × Species Performance
          </div>
          <div className="text-[12px] font-mono" style={{ color: 'var(--surface-muted)' }}>
            Average Biological Efficiency (BE%)
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-16 flex items-center justify-center text-[12px] font-mono text-surface-muted">Loading analytics...</div>
      ) : error ? (
        <div className="text-[12px] text-danger font-mono break-words">{error}</div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl px-4 py-6 text-center text-[13px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--surface-muted)' }}>
          No harvest data available yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[400px]">
            <thead>
              <tr className="border-b border-surface-800">
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal">Species</th>
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal">Recipe / Substrate</th>
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal text-right">Avg BE%</th>
                <th className="py-2 px-3 text-[10px] font-mono uppercase tracking-eyebrow text-surface-muted font-normal text-right">Harvests</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-surface-800/30 transition-colors">
                  <td className="py-2.5 px-3 text-[14px] font-semibold text-surface-text whitespace-nowrap">
                    {row.species_name}
                  </td>
                  <td className="py-2.5 px-3 text-[13px] text-surface-muted">
                    {row.recipe_name || 'Generic (No Recipe)'}
                  </td>
                  <td className="py-2.5 px-3 text-[14px] font-mono font-medium text-bio-green text-right">
                    {(row.avg_biological_efficiency * 100).toFixed(1)}%
                  </td>
                  <td className="py-2.5 px-3 text-[12px] font-mono text-surface-muted text-right">
                    {row.harvest_count}
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
