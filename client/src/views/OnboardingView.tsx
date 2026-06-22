import { useState } from 'react'
import { motion } from 'framer-motion'
import { setupSettings } from '../lib/api'
import { Cpu, Flask, CaretRight, Check } from 'phosphor-react'

export default function OnboardingView({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hardware defaults
  const [hardware, setHardware] = useState({
    maxPcRunsPerDay: 1,
    maxBagsPerPcRun: 4,
    grainCycleMins: 150,
    grainPrepCoolMins: 90,
    bulkCycleMins: 150,
    bulkPrepCoolMins: 90,
    microlabCycleMins: 30,
    microlabPrepCoolMins: 45,
    dailyAvailableMins: 480,
    schedulingHorizonDays: 28,
  })

  // Basic species setup
  const [speciesName, setSpeciesName] = useState('Blue Oyster')

  const handleNext = () => setStep(2)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await setupSettings({
        hardware: {
          max_pc_runs_per_day: hardware.maxPcRunsPerDay,
          max_bags_per_pc_run: hardware.maxBagsPerPcRun,
          grain_cycle_mins: hardware.grainCycleMins,
          grain_prep_cool_mins: hardware.grainPrepCoolMins,
          bulk_cycle_mins: hardware.bulkCycleMins,
          bulk_prep_cool_mins: hardware.bulkPrepCoolMins,
          microlab_cycle_mins: hardware.microlabCycleMins,
          microlab_prep_cool_mins: hardware.microlabPrepCoolMins,
          daily_available_mins: hardware.dailyAvailableMins,
          scheduling_horizon_days: hardware.schedulingHorizonDays,
        },
        species: [{
          commonName: speciesName,
          substrateType: 'HWFP',
          bulkPrepMethod: 'PC',
        }]
      })
      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to complete setup.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-900 animate-rise_in overflow-y-auto">
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 pt-16 pb-12">
        <div className="mb-8">
          <h1 className="text-4xl font-sans font-bold leading-tight" style={{ color: 'var(--surface-text)' }}>
            Welcome to Myco Lab
          </h1>
          <p className="mt-3 text-[15px]" style={{ color: 'var(--surface-muted)' }}>
            Let's configure your lab hardware and first species to get started.
          </p>
        </div>

        {step === 1 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 flex flex-col">
            <div className="lab-card p-5 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
                  <Cpu size={20} />
                </div>
                <h2 className="font-semibold text-xl" style={{ color: 'var(--surface-text)' }}>Hardware Setup</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Max PC Runs per day</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full bg-surface-900 border border-surface-border rounded-lg px-3 py-2 text-surface-text focus:border-bio-green focus:ring-1 focus:ring-bio-green outline-none transition-all"
                    value={hardware.maxPcRunsPerDay}
                    onChange={e => setHardware({...hardware, maxPcRunsPerDay: parseInt(e.target.value) || 1})}
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Max Bags per PC run</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full bg-surface-900 border border-surface-border rounded-lg px-3 py-2 text-surface-text focus:border-bio-green focus:ring-1 focus:ring-bio-green outline-none transition-all"
                    value={hardware.maxBagsPerPcRun}
                    onChange={e => setHardware({...hardware, maxBagsPerPcRun: parseInt(e.target.value) || 1})}
                  />
                </div>
              </div>
            </div>

            <div className="mt-auto pt-6">
              <button onClick={handleNext} className="w-full bg-bio-green text-surface-900 font-semibold h-12 rounded-full flex items-center justify-center gap-2">
                Continue to Species <CaretRight weight="bold" />
              </button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 flex flex-col">
            <div className="lab-card p-5 mb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--bio-green-dim)', color: 'var(--bio-green)' }}>
                  <Flask size={20} />
                </div>
                <h2 className="font-semibold text-xl" style={{ color: 'var(--surface-text)' }}>First Species</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Species Name</label>
                  <input
                    type="text"
                    className="w-full bg-surface-900 border border-surface-border rounded-lg px-3 py-2 text-surface-text focus:border-bio-green focus:ring-1 focus:ring-bio-green outline-none transition-all"
                    value={speciesName}
                    onChange={e => setSpeciesName(e.target.value)}
                    placeholder="e.g. Blue Oyster"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-3 rounded-lg bg-danger-dim text-danger text-sm text-center">
                {error}
              </div>
            )}

            <div className="mt-auto pt-6">
              <button 
                onClick={handleSubmit} 
                disabled={isSubmitting || !speciesName.trim()}
                className="w-full bg-bio-green text-surface-900 font-semibold h-12 rounded-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? 'Setting up...' : 'Complete Setup'} <Check weight="bold" />
              </button>
              <button onClick={() => setStep(1)} className="w-full text-surface-muted text-sm font-semibold h-12 mt-2">
                Back
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
