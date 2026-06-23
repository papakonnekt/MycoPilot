import { useEffect, useState } from 'react'
import { getSchedulerCapacity, type CapacityDay } from '../lib/api'
import { parseISO, format } from 'date-fns'

export function CapacityPlannerWidget() {
  const [data, setData] = useState<CapacityDay[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getSchedulerCapacity().then(res => {
      if (active && res.success && res.data) {
        setData(res.data)
      }
      if (active) setLoading(false)
    }).catch(err => {
      console.error(err)
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])


  if (loading) {
    return (
      <div className="lab-card p-6 min-h-[300px] flex items-center justify-center">
        <div className="text-sm font-mono uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
          Loading Capacity...
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="lab-card p-6">
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--surface-text)' }}>Scheduler Capacity Forecast</h3>
        <p className="text-sm" style={{ color: 'var(--surface-muted)' }}>No capacity data available.</p>
      </div>
    )
  }

  return (
    <div className="lab-card p-5 md:p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold leading-none" style={{ color: 'var(--surface-text)' }}>
            Capacity Planner
          </h3>
          <p className="text-[11px] font-mono uppercase tracking-eyebrow mt-1.5" style={{ color: 'var(--surface-muted)' }}>
            PC Runs & Task Load over {data.length} days
          </p>
        </div>
      </div>

      <div className="overflow-x-auto hide-scrollbar pb-4 -mx-5 px-5 md:mx-0 md:px-0">
        <div className="flex gap-2 min-w-max">
          {data.map((day) => {
            const dateObj = parseISO(day.date)
            const pcPct = Math.min(100, Math.round((day.pc_runs / (day.max_pc_runs || 1)) * 100))
            const minPct = Math.min(100, Math.round((day.task_mins / (day.max_task_mins || 1)) * 100))
            
            const isPcOver = day.pc_runs > day.max_pc_runs
            const isMinsOver = day.task_mins > day.max_task_mins

            return (
              <div 
                key={day.date} 
                className="w-16 shrink-0 flex flex-col items-center p-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-center mb-1" style={{ color: 'var(--surface-muted)' }}>
                  {format(dateObj, 'MMM d')}
                </div>
                
                {/* PC Run Bar */}
                <div className="w-full flex-1 flex flex-col justify-end items-center h-24 mb-2 bg-[#000]/20 rounded overflow-hidden">
                  <div 
                    className="w-full rounded-t transition-all"
                    style={{ 
                      height: `${pcPct}%`,
                      backgroundColor: isPcOver ? 'var(--danger)' : 'var(--bio-green)',
                      opacity: pcPct > 0 ? 1 : 0
                    }}
                  />
                </div>
                <div className="text-[11px] font-bold text-center mb-4" style={{ color: isPcOver ? 'var(--danger)' : 'var(--surface-text)' }}>
                  {day.pc_runs}/{day.max_pc_runs}
                </div>

                {/* Task Load Bar */}
                <div className="w-full flex-1 flex flex-col justify-end items-center h-16 mb-2 bg-[#000]/20 rounded overflow-hidden">
                  <div 
                    className="w-full rounded-t transition-all"
                    style={{ 
                      height: `${minPct}%`,
                      backgroundColor: isMinsOver ? 'var(--danger)' : '#6C83CD',
                      opacity: minPct > 0 ? 1 : 0
                    }}
                  />
                </div>
                <div className="text-[11px] font-bold text-center" style={{ color: isMinsOver ? 'var(--danger)' : 'var(--surface-text)' }}>
                  {Math.round(day.task_mins / 60)}h
                </div>
              </div>
            )
          })}
        </div>
      </div>
      
      <div className="flex gap-4 mt-2 justify-center">
        <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--bio-green)' }} />
          PC Usage
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-eyebrow" style={{ color: 'var(--surface-muted)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: '#6C83CD' }} />
          Task Hrs
        </div>
      </div>
    </div>
  )
}
