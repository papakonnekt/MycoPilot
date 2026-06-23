import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { setupSettings } from '../lib/api'
import { CaretRight, Check, CaretLeft, Info } from 'phosphor-react'

// Helpful tooltip/explanation component
function HelpCard({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="bg-surface-800 rounded-lg p-4 border border-surface-border mt-2">
      <div className="flex items-center gap-2 mb-2">
        <Info size={16} weight="bold" className="text-bio-green" />
        <h4 className="font-semibold text-sm text-surface-text">{title}</h4>
      </div>
      <div className="text-[13px] text-surface-muted leading-relaxed">
        {children}
      </div>
    </div>
  )
}

export default function OnboardingView({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<number>(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // -- Step 1: Hardware --
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

  // -- Step 2: Species --
  const [species, setSpecies] = useState({
    commonName: 'Blue Oyster',
    substrateType: 'HWFP',
    bulkPrepMethod: 'PC',
    maxGenerations: 3,
  })

  // -- Step 3: Timelines --
  const [timelines, setTimelines] = useState({
    lcToGen1DaysMin: 14, lcToGen1DaysMax: 21,
    gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 21,
    bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 21,
    fruitingDaysMin: 7, fruitingDaysMax: 14,
  })

  // -- Step 4: Targets --
  const [targets, setTargets] = useState({
    weeklyTargetBlocks: 10,
    fridgeTargetBags: 10,
    fridgeMinBags: 2,
  })

  // -- Step 5: Inventory --
  const [inventory, setInventory] = useState({
    startingLcVolumeMl: 200,
    sterilizedGrains: [] as { weightLbs: number, quantity: number }[],
    sterilizedSubstrate: [] as { weightLbs: number, quantity: number }[],
  })

  // -- Step 6: Incubating --
  const [incubating, setIncubating] = useState([] as { stage: string, quantity: number, colonizationPct: number }[])

  const nextStep = () => {
    window.scrollTo(0, 0);
    setStep(s => Math.min(s + 1, 6))
  }
  const prevStep = () => {
    window.scrollTo(0, 0);
    setStep(s => Math.max(s - 1, 1))
  }

  const handleAddGrain = () => setInventory(i => ({ ...i, sterilizedGrains: [...i.sterilizedGrains, { weightLbs: 5, quantity: 1 }] }))
  const handleAddSubstrate = () => setInventory(i => ({ ...i, sterilizedSubstrate: [...i.sterilizedSubstrate, { weightLbs: 5, quantity: 1 }] }))
  const handleAddIncubating = () => setIncubating(i => [...i, { stage: 'GEN1_GRAIN', quantity: 1, colonizationPct: 0 }])

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
          ...species,
          ...timelines,
          ...targets,
          ...inventory,
          incubating
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
      <div className="flex-1 flex flex-col max-w-xl mx-auto w-full px-4 pt-16 pb-24">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${step >= i ? 'bg-bio-green' : 'bg-surface-800'}`} />
            ))}
          </div>
          <h1 className="text-3xl font-sans font-bold leading-tight" style={{ color: 'var(--surface-text)' }}>
            {step === 1 && "Hardware & Sterilization"}
            {step === 2 && "Species & Genetics"}
            {step === 3 && "Biological Timelines"}
            {step === 4 && "Production Targets"}
            {step === 5 && "Current Inventory"}
            {step === 6 && "Incubating Spawn"}
          </h1>
          <p className="mt-2 text-[15px]" style={{ color: 'var(--surface-muted)' }}>
            Step {step} of 6
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div 
            key={step}
            initial={{ opacity: 0, x: 20 }} 
            animate={{ opacity: 1, x: 0 }} 
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col"
          >
            {/* ── STEP 1: HARDWARE ── */}
            {step === 1 && (
              <div className="space-y-6">
                <HelpCard title="What is this?">
                  This helps the scheduling engine know how much sterilization capacity you have. 
                  A "PC" is a Pressure Cooker (or sterilizer).
                </HelpCard>
                
                <div className="lab-card p-5 space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Max PC Runs per day</label>
                    <input type="number" min="1" className="lab-input w-full" value={hardware.maxPcRunsPerDay} onChange={e => setHardware({...hardware, maxPcRunsPerDay: parseInt(e.target.value) || 1})} />
                    <p className="text-xs text-surface-muted mt-1">How many times a day are you willing to run your pressure cooker?</p>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Max Bags per PC run</label>
                    <input type="number" min="1" className="lab-input w-full" value={hardware.maxBagsPerPcRun} onChange={e => setHardware({...hardware, maxBagsPerPcRun: parseInt(e.target.value) || 1})} />
                    <p className="text-xs text-surface-muted mt-1">How many bags can fit inside your pressure cooker at once?</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Grain Cycle (mins)</label>
                      <input type="number" className="lab-input w-full" value={hardware.grainCycleMins} onChange={e => setHardware({...hardware, grainCycleMins: parseInt(e.target.value) || 0})} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Grain Cool (mins)</label>
                      <input type="number" className="lab-input w-full" value={hardware.grainPrepCoolMins} onChange={e => setHardware({...hardware, grainPrepCoolMins: parseInt(e.target.value) || 0})} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: SPECIES ── */}
            {step === 2 && (
              <div className="space-y-6">
                <HelpCard title="First Species Setup">
                  We'll start by setting up one species (like Blue Oyster or Lion's Mane). You can add more later. 
                  <br/><br/>
                  <b>G2G Transfers:</b> Grain-to-Grain transfers allow you to multiply your spawn exponentially. 
                  Taking 1 master bag to make 10 bags is 1 generation. Doing it again makes 100 bags (2 generations).
                  Limit this to avoid senescence (aging out).
                </HelpCard>
                
                <div className="lab-card p-5 space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Common Name</label>
                    <input type="text" className="lab-input w-full" value={species.commonName} onChange={e => setSpecies({...species, commonName: e.target.value})} placeholder="e.g. Blue Oyster" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Substrate Type</label>
                    <select className="lab-input w-full" value={species.substrateType} onChange={e => setSpecies({...species, substrateType: e.target.value})}>
                      <option value="HWFP">HWFP (Hardwood Fuel Pellets + Soy Hulls)</option>
                      <option value="CVG">CVG (Coco Coir + Vermiculite + Gypsum)</option>
                      <option value="STRAW">Straw</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>How many times do you want to do Grain-to-Grain (G2G)?</label>
                    <input type="number" min="0" max="5" className="lab-input w-full" value={species.maxGenerations} onChange={e => setSpecies({...species, maxGenerations: parseInt(e.target.value) || 0})} />
                    <p className="text-xs text-surface-muted mt-1">Recommended: 2 or 3. 0 means you only inoculate from Liquid Culture.</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3: TIMELINES ── */}
            {step === 3 && (
              <div className="space-y-6">
                <HelpCard title="Growth Speeds">
                  How many days does it usually take this species to grow at each stage? 
                  Provide a minimum (fastest) and maximum (slowest) number of days. It is normal for this to be a wide range (e.g., 2 to 45 days).
                </HelpCard>
                
                <div className="flex gap-2 pb-2 overflow-x-auto hide-scrollbar">
                  <button onClick={() => setTimelines({
                    lcToGen1DaysMin: 10, lcToGen1DaysMax: 14,
                    gen2ColonizationDaysMin: 10, gen2ColonizationDaysMax: 14,
                    bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 21,
                    fruitingDaysMin: 7, fruitingDaysMax: 14,
                  })} className="shrink-0 text-xs bg-surface-800 text-bio-green px-3 py-1.5 rounded-full hover:bg-surface-700 transition-colors">
                    Oyster Preset
                  </button>
                  <button onClick={() => setTimelines({
                    lcToGen1DaysMin: 14, lcToGen1DaysMax: 21,
                    gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 21,
                    bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 28,
                    fruitingDaysMin: 14, fruitingDaysMax: 28,
                  })} className="shrink-0 text-xs bg-surface-800 text-bio-green px-3 py-1.5 rounded-full hover:bg-surface-700 transition-colors">
                    Lion's Mane Preset
                  </button>
                  <button onClick={() => setTimelines({
                    lcToGen1DaysMin: 14, lcToGen1DaysMax: 30,
                    gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 30,
                    bulkColonizationDaysMin: 30, bulkColonizationDaysMax: 60,
                    fruitingDaysMin: 14, fruitingDaysMax: 30,
                  })} className="shrink-0 text-xs bg-surface-800 text-bio-green px-3 py-1.5 rounded-full hover:bg-surface-700 transition-colors">
                    Shiitake Preset
                  </button>
                </div>

                <div className="lab-card p-5 space-y-4">
                  <div>
                    <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--surface-muted)' }}>Liquid Culture to Gen 1 Grain Colonization</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-muted w-8">From</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Min" value={timelines.lcToGen1DaysMin} onChange={e => setTimelines({...timelines, lcToGen1DaysMin: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-4 text-center">to</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Max" value={timelines.lcToGen1DaysMax} onChange={e => setTimelines({...timelines, lcToGen1DaysMax: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-8">days</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--surface-muted)' }}>Gen 2 Grain Colonization</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-muted w-8">From</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Min" value={timelines.gen2ColonizationDaysMin} onChange={e => setTimelines({...timelines, gen2ColonizationDaysMin: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-4 text-center">to</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Max" value={timelines.gen2ColonizationDaysMax} onChange={e => setTimelines({...timelines, gen2ColonizationDaysMax: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-8">days</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--surface-muted)' }}>Bulk Substrate Colonization</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-muted w-8">From</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Min" value={timelines.bulkColonizationDaysMin} onChange={e => setTimelines({...timelines, bulkColonizationDaysMin: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-4 text-center">to</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Max" value={timelines.bulkColonizationDaysMax} onChange={e => setTimelines({...timelines, bulkColonizationDaysMax: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-8">days</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--surface-muted)' }}>Fruiting (Pinning to Harvest)</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-muted w-8">From</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Min" value={timelines.fruitingDaysMin} onChange={e => setTimelines({...timelines, fruitingDaysMin: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-4 text-center">to</span>
                      <input type="number" min="0" max="100" className="lab-input flex-1" placeholder="Max" value={timelines.fruitingDaysMax} onChange={e => setTimelines({...timelines, fruitingDaysMax: parseInt(e.target.value) || 0})} />
                      <span className="text-xs text-surface-muted w-8">days</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 4: TARGETS ── */}
            {step === 4 && (
              <div className="space-y-6">
                <HelpCard title="Production Goals">
                  The scheduling engine will work backwards from your weekly targets to tell you what tasks to do each day. 
                  Fridge buffers ensure you always have fully colonized grain ready to go when you want to make bulk blocks.
                </HelpCard>
                
                <div className="lab-card p-5 space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Weekly Target Blocks</label>
                    <input type="number" min="0" className="lab-input w-full" value={targets.weeklyTargetBlocks} onChange={e => setTargets({...targets, weeklyTargetBlocks: parseInt(e.target.value) || 0})} />
                    <p className="text-xs text-surface-muted mt-1">How many bulk fruiting blocks do you want to harvest per week?</p>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Target Fridge Buffer (Grain Bags)</label>
                    <input type="number" min="0" className="lab-input w-full" value={targets.fridgeTargetBags} onChange={e => setTargets({...targets, fridgeTargetBags: parseInt(e.target.value) || 0})} />
                    <p className="text-xs text-surface-muted mt-1">Ideal number of fully colonized grain bags resting in the fridge.</p>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Minimum Fridge Buffer (Grain Bags)</label>
                    <input type="number" min="0" className="lab-input w-full" value={targets.fridgeMinBags} onChange={e => setTargets({...targets, fridgeMinBags: parseInt(e.target.value) || 0})} />
                    <p className="text-xs text-surface-muted mt-1">If the fridge drops below this number, the app flags an urgent shortage.</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 5: INVENTORY ── */}
            {step === 5 && (
              <div className="space-y-6">
                <HelpCard title="Current Available Materials">
                  Let's log any Liquid Culture syringes/jars you have, and any un-inoculated bags of grains or substrate you have already sterilized and ready to use. 
                  (If you don't have any, just skip this step).
                </HelpCard>
                
                <div className="space-y-4">
                  <div className="lab-card p-4">
                    <label className="block text-[13px] font-semibold mb-1" style={{ color: 'var(--surface-muted)' }}>Liquid Culture (mL)</label>
                    <input type="number" min="0" className="lab-input w-full" value={inventory.startingLcVolumeMl} onChange={e => setInventory({...inventory, startingLcVolumeMl: parseInt(e.target.value) || 0})} />
                    <p className="text-xs text-surface-muted mt-1">1 syringe is typically 10mL.</p>
                  </div>

                  <div className="lab-card p-4">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[13px] font-semibold" style={{ color: 'var(--surface-muted)' }}>Sterilized Grain Bags (Ready to inoculate)</label>
                      <button onClick={handleAddGrain} className="text-xs bg-surface-800 px-2 py-1 rounded text-bio-green hover:bg-surface-700 transition-colors">+ Add Type</button>
                    </div>
                    {inventory.sterilizedGrains.length === 0 && <p className="text-xs text-surface-muted">None currently added.</p>}
                    <div className="space-y-2">
                      {inventory.sterilizedGrains.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input type="number" className="lab-input flex-1" placeholder="Quantity" value={item.quantity} onChange={e => { const arr = [...inventory.sterilizedGrains]; arr[idx].quantity = parseInt(e.target.value) || 0; setInventory({...inventory, sterilizedGrains: arr})}} />
                          <span className="text-sm">bags at</span>
                          <input type="number" className="lab-input flex-1" placeholder="Lbs" value={item.weightLbs} onChange={e => { const arr = [...inventory.sterilizedGrains]; arr[idx].weightLbs = parseFloat(e.target.value) || 0; setInventory({...inventory, sterilizedGrains: arr})}} />
                          <span className="text-sm">lbs</span>
                          <button onClick={() => setInventory({...inventory, sterilizedGrains: inventory.sterilizedGrains.filter((_, i) => i !== idx)})} className="text-danger text-lg p-1">&times;</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lab-card p-4">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[13px] font-semibold" style={{ color: 'var(--surface-muted)' }}>Sterilized Substrate Blocks</label>
                      <button onClick={handleAddSubstrate} className="text-xs bg-surface-800 px-2 py-1 rounded text-bio-green hover:bg-surface-700 transition-colors">+ Add Type</button>
                    </div>
                    {inventory.sterilizedSubstrate.length === 0 && <p className="text-xs text-surface-muted">None currently added.</p>}
                    <div className="space-y-2">
                      {inventory.sterilizedSubstrate.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input type="number" className="lab-input flex-1" placeholder="Quantity" value={item.quantity} onChange={e => { const arr = [...inventory.sterilizedSubstrate]; arr[idx].quantity = parseInt(e.target.value) || 0; setInventory({...inventory, sterilizedSubstrate: arr})}} />
                          <span className="text-sm">bags at</span>
                          <input type="number" className="lab-input flex-1" placeholder="Lbs" value={item.weightLbs} onChange={e => { const arr = [...inventory.sterilizedSubstrate]; arr[idx].weightLbs = parseFloat(e.target.value) || 0; setInventory({...inventory, sterilizedSubstrate: arr})}} />
                          <span className="text-sm">lbs</span>
                          <button onClick={() => setInventory({...inventory, sterilizedSubstrate: inventory.sterilizedSubstrate.filter((_, i) => i !== idx)})} className="text-danger text-lg p-1">&times;</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 6: INCUBATING ── */}
            {step === 6 && (
              <div className="space-y-6">
                <HelpCard title="Currently Growing Spawn">
                  Do you already have any bags that have been inoculated and are currently colonizing? 
                  Adding them here ensures the schedule knows what's coming up in the pipeline.
                </HelpCard>
                
                <div className="lab-card p-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-[13px] font-semibold" style={{ color: 'var(--surface-muted)' }}>Incubating Bags</label>
                    <button onClick={handleAddIncubating} className="text-xs bg-surface-800 px-2 py-1 rounded text-bio-green hover:bg-surface-700 transition-colors">+ Add Batch</button>
                  </div>
                  {incubating.length === 0 && <p className="text-xs text-surface-muted">None currently added.</p>}
                  
                  <div className="space-y-3">
                    {incubating.map((item, idx) => (
                      <div key={idx} className="flex flex-col gap-3 bg-surface-900 p-3 rounded border border-surface-border">
                        <div className="flex gap-2 items-center">
                          <input type="number" className="lab-input w-20" placeholder="Qty" value={item.quantity} onChange={e => { const arr = [...incubating]; arr[idx].quantity = parseInt(e.target.value) || 0; setIncubating(arr)}} />
                          <span className="text-sm text-surface-muted">bags</span>
                          <select className="lab-input flex-1" value={item.stage} onChange={e => { const arr = [...incubating]; arr[idx].stage = e.target.value; setIncubating(arr)}}>
                            <option value="GEN1_GRAIN">Gen 1 Grain (from LC)</option>
                            <option value="GEN2_GRAIN">Gen 2 Grain (from G2G)</option>
                            <option value="BULK_BLOCK">Bulk Block</option>
                          </select>
                          <button onClick={() => setIncubating(incubating.filter((_, i) => i !== idx))} className="text-danger text-lg p-1">&times;</button>
                        </div>
                        <div className="flex flex-col gap-1 px-1">
                          <div className="flex justify-between items-center text-xs text-surface-muted">
                            <span>Colonization Progress:</span>
                            <span className="text-bio-green font-mono">{item.colonizationPct || 0}%</span>
                          </div>
                          <input type="range" min="0" max="100" value={item.colonizationPct || 0} onChange={e => { const arr = [...incubating]; arr[idx].colonizationPct = parseInt(e.target.value); setIncubating(arr)}} className="w-full accent-bio-green" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-danger-dim text-danger text-sm text-center">
                    {error}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer Navigation */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface-900 border-t border-surface-border flex gap-3 justify-between">
          <div className="flex-1 max-w-xl mx-auto flex gap-3">
            {step > 1 && (
              <button onClick={prevStep} disabled={isSubmitting} className="flex-1 bg-surface-800 text-surface-text font-semibold h-12 rounded-full flex items-center justify-center gap-2 hover:bg-surface-700 transition-colors disabled:opacity-50">
                <CaretLeft weight="bold" /> Back
              </button>
            )}
            
            {step < 6 ? (
              <button onClick={nextStep} className="flex-[2] bg-bio-green text-surface-900 font-semibold h-12 rounded-full flex items-center justify-center gap-2 hover:bg-opacity-90 transition-colors">
                Continue <CaretRight weight="bold" />
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={isSubmitting || !species.commonName.trim()} className="flex-[2] bg-bio-green text-surface-900 font-semibold h-12 rounded-full flex items-center justify-center gap-2 hover:bg-opacity-90 transition-colors disabled:opacity-50">
                {isSubmitting ? 'Saving...' : 'Complete Setup'} <Check weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
