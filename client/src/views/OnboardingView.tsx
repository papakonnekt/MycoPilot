import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { setupSettings } from '../lib/api'
import {
  CaretRight, CaretLeft, Check, Info, Plus, Trash,
  Flask, Spinner as SpinnerIcon
} from 'phosphor-react'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface RecipeIngredient {
  ingredient: string
  amount?: number
  unit?: string
}

interface Recipe {
  name: string
  notes: string
  ingredients: RecipeIngredient[]
}

interface SpeciesEntry {
  commonName: string
  defaultRecipeIdx?: number
  maxGenerations: number
  bulkPrepMethod: string
  priorityLevel?: number
  lcToGen1DaysMin: number
  lcToGen1DaysMax: number
  gen2ColonizationDaysMin: number
  gen2ColonizationDaysMax: number
  bulkColonizationDaysMin: number
  bulkColonizationDaysMax: number
  fruitingDaysMin: number
  fruitingDaysMax: number
  weeklyTargetBlocks: number
  fridgeTargetBags: number
  fridgeMinBags: number
  startingLcVolumeMl: number
  sterilizedGrains: { weightLbs: number; quantity: number }[]
  sterilizedSubstrate: { weightLbs: number; quantity: number }[]
  incubating: { stage: string; quantity: number; colonizationPct: number; speciesIdx: number }[]
  hasInventoryLogged?: boolean
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function HelpCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-800 rounded-xl p-4 border border-surface-border">
      <div className="flex items-center gap-2 mb-2">
        <Info size={15} weight="bold" className="text-bio-green shrink-0" />
        <h4 className="font-semibold text-[13px] text-surface-text">{title}</h4>
      </div>
      <div className="text-[13px] text-surface-muted leading-relaxed">{children}</div>
    </div>
  )
}

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--surface-muted)' }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] text-surface-muted mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function DayRange({
  label,
  min, max,
  onMin, onMax,
}: {
  label: string
  min: number; max: number
  onMin: (v: number) => void
  onMax: (v: number) => void
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--surface-muted)' }}>
        {label}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-surface-muted w-8">From</span>
        <input
          type="number" min="0" max="365"
          className="lab-input flex-1 text-center"
          value={min}
          onChange={e => {
            const v = intVal(e.target.value);
            onMin(v);
            if (v > max) onMax(v);
          }}
        />
        <span className="text-[12px] text-surface-muted w-4 text-center">to</span>
        <input
          type="number" min="0" max="365"
          className="lab-input flex-1 text-center"
          value={max}
          onChange={e => {
            const v = intVal(e.target.value);
            onMax(v);
            if (v < min) onMin(v);
          }}
        />
        <span className="text-[12px] text-surface-muted w-8">days</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step labels
// ─────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Hardware', icon: '⚙️' },
  { label: 'Recipes', icon: '🧪' },
  { label: 'Species', icon: '🍄' },
  { label: 'Timelines', icon: '⏱' },
  { label: 'Targets', icon: '🎯' },
  { label: 'Inventory', icon: '📦' },
  { label: 'Incubating', icon: '🌱' },
]

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

const intVal = (v: string) => v === '' ? ('' as any) : parseInt(v, 10);
const floatVal = (v: string) => v === '' ? ('' as any) : parseFloat(v);

export default function OnboardingView({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slideDir, setSlideDir] = useState<1 | -1>(1)

  // ── Step 1: Hardware ────────────────────────────────────────
  const [hardware, setHardware] = useState({
    pc_unit_count: 1,
    maxPcRunsPerDay: 1,
    maxBagsPerPcRun: 4,
    grainCycleMins: 150,
    bulkCycleMins: 150,
    microlabCycleMins: 30,
    dailyAvailableMins: 480,
    schedulingHorizonDays: 28,
  })

  // ── Step 2: Recipes ─────────────────────────────────────────
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [newRecipeName, setNewRecipeName] = useState('')

  // ── Step 3: Species ─────────────────────────────────────────
  const [speciesList, setSpeciesList] = useState<SpeciesEntry[]>([
    {
      commonName: '',
      maxGenerations: 2,
      bulkPrepMethod: 'PC',
      lcToGen1DaysMin: 14, lcToGen1DaysMax: 21,
      gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 21,
      bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 21,
      fruitingDaysMin: 7, fruitingDaysMax: 14,
      weeklyTargetBlocks: 0,
      fridgeTargetBags: 0,
      fridgeMinBags: 0,
      startingLcVolumeMl: 0,
      sterilizedGrains: [],
      sterilizedSubstrate: [],
      incubating: [],
      hasInventoryLogged: false,
    }
  ])
  const [activeSpeciesIdx, setActiveSpeciesIdx] = useState(0)

  // ── Global incubating list (step 7) ─────────────────────────
  const [incubating, setIncubating] = useState<
    { speciesIdx: number; stage: string; quantity: number; colonizationPct: number }[]
  >([])

  // ── Navigation ───────────────────────────────────────────────
  const validateStep = (currentStep: number): string | null => {
    if (currentStep === 1) {
      if (hardware.dailyAvailableMins < 30) return "Daily available minutes must be at least 30."
      if (hardware.grainCycleMins <= 0 || hardware.bulkCycleMins <= 0 || hardware.microlabCycleMins <= 0) {
        return "Cycle minutes must be greater than 0."
      }
    }
    if (currentStep === 2) {
      if (recipes.some(r => !r.name.trim())) return "All recipes must have a name."
      for (const r of recipes) {
        if (r.ingredients.length === 0) return `Recipe "${r.name}" must have at least one ingredient.`
        if (r.ingredients.some(i => !i.ingredient.trim())) return `All ingredients in "${r.name}" must have a name.`
      }
    }
    if (currentStep === 3) {
      if (speciesList.length === 0) return "Please add at least one species."
      if (speciesList.some(s => !s.commonName.trim())) return "All species must have a Common Name."
    }
    if (currentStep === 4) {
      for (const s of speciesList) {
        if (s.lcToGen1DaysMin > s.lcToGen1DaysMax) return `Min days cannot exceed max days for ${s.commonName || 'species'}.`
        if (s.gen2ColonizationDaysMin > s.gen2ColonizationDaysMax) return `Min days cannot exceed max days for ${s.commonName || 'species'}.`
        if (s.bulkColonizationDaysMin > s.bulkColonizationDaysMax) return `Min days cannot exceed max days for ${s.commonName || 'species'}.`
        if (s.fruitingDaysMin > s.fruitingDaysMax) return `Min days cannot exceed max days for ${s.commonName || 'species'}.`
      }
    }
    return null;
  }

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    window.scrollTo(0, 0)
    setSlideDir(1)
    setStep(s => Math.min(s + 1, 7))
  }
  const goBack = () => {
    setError(null);
    window.scrollTo(0, 0)
    setSlideDir(-1)
    setStep(s => Math.max(s - 1, 1))
  }

  // ── Recipe helpers ───────────────────────────────────────────
  const addRecipe = () => {
    const name = newRecipeName.trim()
    if (!name) return
    setRecipes(r => [...r, { name, notes: '', ingredients: [{ ingredient: '', amount: undefined, unit: '% by weight' }] }])
    setNewRecipeName('')
  }
  const removeRecipe = (idx: number) => setRecipes(r => r.filter((_, i) => i !== idx))
  const updateRecipe = (idx: number, patch: Partial<Recipe>) =>
    setRecipes(r => r.map((rec, i) => (i === idx ? { ...rec, ...patch } : rec)))
  const addIngredient = (rIdx: number) =>
    setRecipes(r => r.map((rec, i) =>
      i === rIdx ? { ...rec, ingredients: [...rec.ingredients, { ingredient: '', amount: undefined, unit: '% by weight' }] } : rec
    ))
  const removeIngredient = (rIdx: number, iIdx: number) =>
    setRecipes(r => r.map((rec, i) =>
      i === rIdx ? { ...rec, ingredients: rec.ingredients.filter((_, j) => j !== iIdx) } : rec
    ))
  const updateIngredient = (rIdx: number, iIdx: number, patch: Partial<RecipeIngredient>) =>
    setRecipes(r => r.map((rec, i) =>
      i === rIdx
        ? { ...rec, ingredients: rec.ingredients.map((ing, j) => (j === iIdx ? { ...ing, ...patch } : ing)) }
        : rec
    ))

  // ── Species helpers ──────────────────────────────────────────
  const sp = speciesList[activeSpeciesIdx]
  const setSp = (patch: Partial<SpeciesEntry>) =>
    setSpeciesList(list => list.map((s, i) => (i === activeSpeciesIdx ? { ...s, ...patch } : s)))

  const addSpecies = () => {
    setSpeciesList(list => [
      ...list,
      {
        commonName: '', maxGenerations: 2, bulkPrepMethod: 'PC',
        lcToGen1DaysMin: 14, lcToGen1DaysMax: 21,
        gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 21,
        bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 21,
        fruitingDaysMin: 7, fruitingDaysMax: 14,
        weeklyTargetBlocks: 0, fridgeTargetBags: 0, fridgeMinBags: 0,
        startingLcVolumeMl: 0,
        sterilizedGrains: [], sterilizedSubstrate: [], incubating: [],
        hasInventoryLogged: false,
      }
    ])
    setActiveSpeciesIdx(speciesList.length)
  }

  const applyPreset = (preset: 'oyster' | 'lionsmane' | 'shiitake') => {
    const presets = {
      oyster:    { lcToGen1DaysMin: 10, lcToGen1DaysMax: 14, gen2ColonizationDaysMin: 10, gen2ColonizationDaysMax: 14, bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 21, fruitingDaysMin: 7, fruitingDaysMax: 14 },
      lionsmane: { lcToGen1DaysMin: 14, lcToGen1DaysMax: 21, gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 21, bulkColonizationDaysMin: 14, bulkColonizationDaysMax: 28, fruitingDaysMin: 14, fruitingDaysMax: 28 },
      shiitake:  { lcToGen1DaysMin: 14, lcToGen1DaysMax: 30, gen2ColonizationDaysMin: 14, gen2ColonizationDaysMax: 30, bulkColonizationDaysMin: 30, bulkColonizationDaysMax: 60, fruitingDaysMin: 14, fruitingDaysMax: 30 },
    }
    setSp(presets[preset])
  }

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    const valid = speciesList.every(s => s.commonName.trim())
    if (!valid) { setError('Every species needs a name.'); return }

    setIsSubmitting(true)
    setError(null)

    try {
      // Merge global incubating list back into each species
      const speciesWithIncubating = speciesList.map((s, idx) => ({
        ...s,
        incubating: incubating.filter(i => i.speciesIdx === idx).map(i => ({
          stage: i.stage, quantity: i.quantity, colonizationPct: i.colonizationPct,
        })),
      }))

      await setupSettings({
        hardware: {
          pc_unit_count: hardware.pc_unit_count || 1,
          max_pc_runs_per_day: hardware.maxPcRunsPerDay || 1,
          max_bags_per_pc_run: hardware.maxBagsPerPcRun || 4,
          grain_cycle_mins: hardware.grainCycleMins || 150,
          grain_prep_cool_mins: 1440,
          bulk_cycle_mins: hardware.bulkCycleMins || 150,
          bulk_prep_cool_mins: 1440,
          microlab_cycle_mins: hardware.microlabCycleMins || 30,
          microlab_prep_cool_mins: 1440,
          daily_available_mins: hardware.dailyAvailableMins || 480,
          scheduling_horizon_days: hardware.schedulingHorizonDays || 28,
        } as any,
        recipes: recipes.filter(r => r.name.trim()),
        species: speciesWithIncubating.map(s => ({
          commonName: s.commonName,
          bulkPrepMethod: s.bulkPrepMethod,
          maxGenerations: s.maxGenerations,
          lcToGen1DaysMin: Number(s.lcToGen1DaysMin) || 14,
          lcToGen1DaysMax: Number(s.lcToGen1DaysMax) || 21,
          gen2ColonizationDaysMin: Number(s.gen2ColonizationDaysMin) || 14,
          gen2ColonizationDaysMax: Number(s.gen2ColonizationDaysMax) || 21,
          bulkColonizationDaysMin: Number(s.bulkColonizationDaysMin) || 14,
          bulkColonizationDaysMax: Number(s.bulkColonizationDaysMax) || 21,
          fruitingDaysMin: Number(s.fruitingDaysMin) || 7,
          fruitingDaysMax: Number(s.fruitingDaysMax) || 14,
          weeklyTargetBlocks: Number(s.weeklyTargetBlocks) || 0,
          fridgeTargetBags: Number(s.fridgeTargetBags) || 0,
          fridgeMinBags: Number(s.fridgeMinBags) || 0,
          startingLcVolumeMl: Number(s.startingLcVolumeMl) || 0,
          sterilizedGrains: s.sterilizedGrains,
          sterilizedSubstrate: s.sterilizedSubstrate,
          incubating: s.incubating,
          defaultRecipeIdx: s.defaultRecipeIdx,
        })),
      } as any)
      onComplete()
    } catch (err: any) {
      setError(err.message || 'Setup failed. Check your inputs and try again.')
      setIsSubmitting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-surface-900"
      style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {/* Scrollable content area */}
      <div className="flex-1 flex flex-col max-w-xl mx-auto w-full px-4 pt-12 pb-32">

        {/* Progress bar + title */}
        <div className="mb-6">
          <div className="flex items-center gap-1 mb-4">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${step > i ? 'bg-bio-green' : step === i + 1 ? 'bg-bio-green opacity-50' : 'bg-surface-800'}`}
              />
            ))}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl">{STEPS[step - 1].icon}</span>
            <div>
              <h1 className="text-2xl font-bold text-surface-text leading-tight">
                {STEPS[step - 1].label}
              </h1>
              <p className="text-[13px] text-surface-muted mt-0.5">Step {step} of {STEPS.length}</p>
            </div>
          </div>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: slideDir * 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -slideDir * 30 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col"
          >

            {/* ── STEP 1: HARDWARE ─────────────────────────── */}
            {step === 1 && (
              <div className="space-y-4">
                <HelpCard title="Your Pressure Cooker Setup">
                  Tell the engine how much sterilization capacity you have. Cool times are automatic
                  (24 hours, passive) — bags cool while you do other things. The PC is free again
                  ~30 minutes after you finish.
                </HelpCard>

                <div className="lab-card p-5 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <FieldGroup label="Number of PCs" hint="How many pressure cookers?">
                      <input type="number" min="1" className="lab-input w-full"
                        value={hardware.pc_unit_count}
                        onChange={e => setHardware({ ...hardware, pc_unit_count: intVal(e.target.value) })} />
                    </FieldGroup>
                    <FieldGroup label="Max Bags / Run" hint="How many bags fit at once?">
                      <input type="number" min="1" className="lab-input w-full"
                        value={hardware.maxBagsPerPcRun}
                        onChange={e => setHardware({ ...hardware, maxBagsPerPcRun: intVal(e.target.value) })} />
                    </FieldGroup>
                    <FieldGroup label="Max PC Runs / Day" hint="How many times a day will you run it?">
                      <input type="number" min="1" className="lab-input w-full"
                        value={hardware.maxPcRunsPerDay}
                        onChange={e => setHardware({ ...hardware, maxPcRunsPerDay: intVal(e.target.value) })} />
                    </FieldGroup>
                  </div>

                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--surface-muted)' }}>
                      Sterilization Cycle Times
                    </p>
                    <div className="space-y-3">
                      <FieldGroup label="Grain Cycle (minutes)" hint="Time at pressure for grain bags">
                        <input type="number" min="1" className="lab-input w-full"
                          value={hardware.grainCycleMins}
                          onChange={e => setHardware({ ...hardware, grainCycleMins: intVal(e.target.value) })} />
                      </FieldGroup>
                      <FieldGroup label="Bulk Substrate Cycle (minutes)" hint="Time at pressure for bulk blocks">
                        <input type="number" min="1" className="lab-input w-full"
                          value={hardware.bulkCycleMins}
                          onChange={e => setHardware({ ...hardware, bulkCycleMins: intVal(e.target.value) })} />
                      </FieldGroup>
                      <FieldGroup label="Micro-Lab Cycle (minutes)" hint="Time for LC jars, agar plates, etc.">
                        <input type="number" min="1" className="lab-input w-full"
                          value={hardware.microlabCycleMins}
                          onChange={e => setHardware({ ...hardware, microlabCycleMins: intVal(e.target.value) })} />
                      </FieldGroup>
                    </div>
                  </div>

                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--surface-muted)' }}>
                      Daily Budget
                    </p>
                    <FieldGroup label="Available Lab Time / Day (minutes)" hint="How many minutes a day can you spend in the lab? 480 = 8 hrs">
                      <input type="number" min="1" className="lab-input w-full"
                        value={hardware.dailyAvailableMins}
                        onChange={e => setHardware({ ...hardware, dailyAvailableMins: intVal(e.target.value) })} />
                    </FieldGroup>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: RECIPES ──────────────────────────── */}
            {step === 2 && (
              <div className="space-y-4">
                <HelpCard title="Substrate Recipes">
                  Define the mixes you use — these are <strong>independent of species</strong>.
                  Later, you can track which recipe each batch uses and compare yields
                  (e.g. "HWFP Base vs. HWFP + 10% Wheat Bran").
                  <br /><br />
                  You can skip this and add recipes later in Settings.
                </HelpCard>

                {/* Add new recipe */}
                <div className="lab-card p-4">
                  <p className="text-[13px] font-semibold text-surface-muted mb-2">Add Recipe</p>
                  <div className="flex gap-2">
                    <input
                      type="text" className="lab-input flex-1" placeholder='e.g. "HWFP + 10% Wheat Bran"'
                      value={newRecipeName}
                      onChange={e => setNewRecipeName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addRecipe()}
                    />
                    <button
                      onClick={addRecipe}
                      className="bg-bio-green text-surface-900 font-bold px-4 rounded-lg flex items-center gap-1 text-sm"
                    >
                      <Plus weight="bold" size={14} /> Add
                    </button>
                  </div>
                  {/* Quick starter recipes */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {['HWFP Base', 'HWFP + 10% Wheat Bran', 'HWFP + 20% Wheat Bran', 'CVG'].map(preset => (
                      <button
                        key={preset}
                        onClick={() => {
                          if (!recipes.find(r => r.name === preset)) {
                            setRecipes(r => [...r, { name: preset, notes: '', ingredients: [] }])
                          }
                        }}
                        className="text-[12px] px-2.5 py-1 rounded-full bg-surface-800 text-bio-green border border-surface-border hover:bg-surface-700 transition-colors"
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {recipes.length === 0 && (
                  <p className="text-[13px] text-surface-muted text-center py-4">No recipes yet. Add one above or skip.</p>
                )}

                {/* Recipe list */}
                <div className="space-y-4">
                  {recipes.map((recipe, rIdx) => (
                    <div key={rIdx} className="lab-card p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Flask size={16} className="text-bio-green shrink-0" />
                        <input
                          type="text" className="lab-input flex-1 font-semibold"
                          value={recipe.name}
                          onChange={e => updateRecipe(rIdx, { name: e.target.value })}
                          placeholder="Recipe name"
                        />
                        <button onClick={() => removeRecipe(rIdx)} className="text-danger p-1.5 rounded hover:bg-danger-dim transition-colors">
                          <Trash size={15} />
                        </button>
                      </div>

                      {/* Ingredients */}
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide text-surface-muted font-semibold">Ingredients</p>
                        {recipe.ingredients.map((ing, iIdx) => (
                          <div key={iIdx} className="flex items-center gap-2">
                            <input
                              type="text" className="lab-input flex-1 text-sm" placeholder="Ingredient (e.g. HWFP)"
                              value={ing.ingredient}
                              onChange={e => updateIngredient(rIdx, iIdx, { ingredient: e.target.value })}
                            />
                            <input
                              type="number" className="lab-input w-16 text-sm text-center" placeholder="Amt"
                              value={ing.amount ?? ''}
                              onChange={e => updateIngredient(rIdx, iIdx, { amount: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                            />
                            <select className="lab-input text-sm" value={ing.unit ?? '% by weight'} onChange={e => updateIngredient(rIdx, iIdx, { unit: e.target.value })}>
                              <option value="% by weight">% by weight</option>
                              <option value="cups">cups</option>
                              <option value="lbs">lbs</option>
                              <option value="Liters">Liters</option>
                              <option value="gallons">gallons</option>
                            </select>
                            <button onClick={() => removeIngredient(rIdx, iIdx)} className="text-danger p-1 rounded hover:bg-danger-dim transition-colors">
                              <Trash size={13} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => addIngredient(rIdx)}
                          className="text-[12px] text-bio-green flex items-center gap-1 mt-1"
                        >
                          <Plus size={12} weight="bold" /> Add ingredient
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 3: SPECIES ───────────────────────────── */}
            {step === 3 && (
              <div className="space-y-4">
                <HelpCard title="Your Species">
                  Add each mushroom species you grow. Substrate recipes are <strong>not tied here</strong>
                  — you choose the recipe per batch when you inoculate.
                  G2G (Grain-to-Grain) is how many times you expand before fruiting.
                </HelpCard>

                {/* Species tabs */}
                {speciesList.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                    {speciesList.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveSpeciesIdx(idx)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${activeSpeciesIdx === idx ? 'bg-bio-green text-surface-900' : 'bg-surface-800 text-surface-muted hover:bg-surface-700'}`}
                      >
                        {s.commonName || `Species ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                )}

                <div className="lab-card p-5 space-y-4">
                  <FieldGroup label="Common Name" hint='e.g. "Blue Oyster", "Lions Mane", "Shiitake"'>
                    <input type="text" className="lab-input w-full"
                      placeholder="e.g. Blue Oyster"
                      value={sp.commonName}
                      onChange={e => setSp({ commonName: e.target.value })} />
                  </FieldGroup>

                  <FieldGroup label="G2G Generations" hint="How many Grain-to-Grain transfers before fruiting? 1 = inoculate bulk directly from Gen 1 Grain (LC Only).">
                    <input type="number" min="1" max="5" className="lab-input w-full"
                      value={sp.maxGenerations}
                      onChange={e => setSp({ maxGenerations: intVal(e.target.value) })} />
                    <div className="flex gap-1 mt-1.5 overflow-x-auto hide-scrollbar">
                      {[1, 2, 3, 4].map(n => (
                        <button
                          key={n} onClick={() => setSp({ maxGenerations: n })}
                          className={`shrink-0 text-[12px] px-3 py-1 rounded-full transition-colors ${sp.maxGenerations === n ? 'bg-bio-green text-surface-900 font-bold' : 'bg-surface-800 text-surface-muted'}`}
                        >
                          {n === 1 ? 'LC Only' : `${n - 1}x G2G`}
                        </button>
                      ))}
                    </div>
                  </FieldGroup>

                  <FieldGroup label="Priority Level" hint="1 is Highest Priority. High priority species are scheduled first if PC space is limited.">
                    <input type="number" min="1" max="10" className="lab-input w-full"
                      value={sp.priorityLevel ?? 3}
                      onChange={e => setSp({ priorityLevel: intVal(e.target.value) })} />
                  </FieldGroup>

                  <FieldGroup label="Bulk Prep Method">
                    <select className="lab-input w-full" value={sp.bulkPrepMethod}
                      onChange={e => setSp({ bulkPrepMethod: e.target.value })}>
                      <option value="PC">Pressure Cook (PC)</option>
                      <option value="PASTEURIZE">Pasteurize</option>
                      <option value="NONE">No sterilization needed</option>
                    </select>
                  </FieldGroup>

                  {recipes.length > 0 && (
                    <FieldGroup label="Default Substrate Recipe" hint="Which recipe do you use for this species' bulk blocks?">
                      <select className="lab-input w-full" value={sp.defaultRecipeIdx ?? ''} onChange={e => setSp({ defaultRecipeIdx: e.target.value !== '' ? intVal(e.target.value) : undefined })}>
                        <option value="">None (choose per batch)</option>
                        {recipes.map((r, i) => (
                          <option key={i} value={i}>{r.name}</option>
                        ))}
                      </select>
                    </FieldGroup>
                  )}
                </div>

                <button
                  onClick={addSpecies}
                  className="w-full bg-surface-800 text-bio-green font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-surface-700 transition-colors border border-surface-border"
                >
                  <Plus weight="bold" size={16} /> Add Another Species
                </button>
              </div>
            )}

            {/* ── STEP 4: TIMELINES ─────────────────────────── */}
            {step === 4 && (
              <div className="space-y-4">
                <HelpCard title="Biological Growth Timelines">
                  How long does each stage take for <strong>{sp.commonName || 'this species'}</strong>?
                  Give a min (fastest) and max (slowest). The scheduler uses the max as the safety deadline.
                </HelpCard>

                {/* Species selector if multiple */}
                {speciesList.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                    {speciesList.map((s, idx) => (
                      <button key={idx} onClick={() => setActiveSpeciesIdx(idx)}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${activeSpeciesIdx === idx ? 'bg-bio-green text-surface-900' : 'bg-surface-800 text-surface-muted'}`}>
                        {s.commonName || `Species ${idx + 1}`}
                      </button>
                    ))}
                  </div>
                )}

                {/* Presets */}
                <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                  {(['oyster', 'lionsmane', 'shiitake'] as const).map(p => (
                    <button key={p} onClick={() => applyPreset(p)}
                      className="shrink-0 text-[12px] bg-surface-800 text-bio-green px-3 py-1.5 rounded-full hover:bg-surface-700 transition-colors capitalize">
                      {p === 'lionsmane' ? "Lion's Mane" : p.charAt(0).toUpperCase() + p.slice(1)} Preset
                    </button>
                  ))}
                </div>

                <div className="lab-card p-5 space-y-5">
                  <DayRange label="LC → Gen 1 Grain Colonization"
                    min={sp.lcToGen1DaysMin} max={sp.lcToGen1DaysMax}
                    onMin={v => setSp({ lcToGen1DaysMin: v })} onMax={v => setSp({ lcToGen1DaysMax: v })} />
                  {sp.maxGenerations > 1 && (
                    <DayRange label="Gen 2 Grain Colonization (G2G)"
                      min={sp.gen2ColonizationDaysMin} max={sp.gen2ColonizationDaysMax}
                      onMin={v => setSp({ gen2ColonizationDaysMin: v })} onMax={v => setSp({ gen2ColonizationDaysMax: v })} />
                  )}
                  <DayRange label="Bulk Block Colonization"
                    min={sp.bulkColonizationDaysMin} max={sp.bulkColonizationDaysMax}
                    onMin={v => setSp({ bulkColonizationDaysMin: v })} onMax={v => setSp({ bulkColonizationDaysMax: v })} />
                  <DayRange label="Fruiting (Pin to Harvest)"
                    min={sp.fruitingDaysMin} max={sp.fruitingDaysMax}
                    onMin={v => setSp({ fruitingDaysMin: v })} onMax={v => setSp({ fruitingDaysMax: v })} />
                </div>
              </div>
            )}

            {/* ── STEP 5: TARGETS ───────────────────────────── */}
            {step === 5 && (
              <div className="space-y-4">
                <HelpCard title="Production Targets">
                  The engine works backwards from your weekly harvest target to figure out what
                  to sterilize and inoculate each day. The fridge buffer keeps colonized grain
                  ready so you can start bulk blocks on demand.
                </HelpCard>

                <div className="space-y-4">
                  {speciesList.map((s, idx) => {
                    if (s.weeklyTargetBlocks === 0 && s.fridgeTargetBags === 0) return null;
                    return (
                      <div key={idx} className="lab-card p-5 space-y-5">
                        <div className="flex justify-between items-center border-b border-surface-border pb-3 mb-2">
                          <h3 className="font-bold text-surface-text">{s.commonName || `Species ${idx + 1}`}</h3>
                          <button
                            onClick={() => {
                              const newList = [...speciesList];
                              newList[idx].weeklyTargetBlocks = 0;
                              newList[idx].fridgeTargetBags = 0;
                              newList[idx].fridgeMinBags = 0;
                              setSpeciesList(newList);
                            }}
                            className="text-danger p-1.5 rounded hover:bg-danger-dim transition-colors flex items-center gap-1 text-[12px] font-semibold"
                          >
                            <Trash size={14} /> Remove Target
                          </button>
                        </div>
                        <FieldGroup label="Weekly Target — Fruiting Blocks" hint="How many bulk blocks do you want to harvest per week?">
                          <input type="number" min="0" className="lab-input w-full"
                            value={s.weeklyTargetBlocks}
                            onChange={e => {
                              const newList = [...speciesList];
                              newList[idx].weeklyTargetBlocks = intVal(e.target.value);
                              setSpeciesList(newList);
                            }} />
                        </FieldGroup>
                        <FieldGroup label="Fridge Target (Grain Bags)" hint="Ideal number of fully colonized bags resting in the fridge">
                          <input type="number" min="0" className="lab-input w-full"
                            value={s.fridgeTargetBags}
                            onChange={e => {
                              const newList = [...speciesList];
                              newList[idx].fridgeTargetBags = intVal(e.target.value);
                              setSpeciesList(newList);
                            }} />
                        </FieldGroup>
                        <FieldGroup label="Fridge Minimum (Grain Bags)" hint="If the fridge drops below this, the app flags an urgent shortage">
                          <input type="number" min="0" className="lab-input w-full"
                            value={s.fridgeMinBags}
                            onChange={e => {
                              const newList = [...speciesList];
                              newList[idx].fridgeMinBags = intVal(e.target.value);
                              setSpeciesList(newList);
                            }} />
                        </FieldGroup>
                      </div>
                    );
                  })}
                </div>

                <div className="lab-card p-4">
                  <p className="text-[13px] font-semibold text-surface-muted mb-2">Add Target for Species</p>
                  <select
                    className="lab-input w-full"
                    value=""
                    onChange={e => {
                      if (!e.target.value) return;
                      const idx = intVal(e.target.value);
                      const newList = [...speciesList];
                      newList[idx].weeklyTargetBlocks = 5;
                      newList[idx].fridgeTargetBags = 8;
                      newList[idx].fridgeMinBags = 2;
                      setSpeciesList(newList);
                    }}
                  >
                    <option value="">+ Select Species...</option>
                    {speciesList.map((s, idx) => {
                      if (s.weeklyTargetBlocks > 0 || s.fridgeTargetBags > 0) return null;
                      return <option key={idx} value={idx}>{s.commonName || `Species ${idx + 1}`}</option>
                    })}
                  </select>
                </div>
              </div>
            )}

            {/* ── STEP 6: INVENTORY ─────────────────────────── */}
            {step === 6 && (
              <div className="space-y-4">
                <HelpCard title="Materials On Hand">
                  Log any LC, grain bags, or substrate blocks you already have ready.
                  This is optional — skip if you're starting from scratch.
                </HelpCard>

                <div className="space-y-4">
                  {speciesList.map((sp, idx) => {
                    if (!sp.hasInventoryLogged) return null;
                    return (
                      <div key={idx} className="lab-card p-5 space-y-4">
                        <div className="flex justify-between items-center border-b border-surface-border pb-3">
                          <h3 className="font-bold text-surface-text">{sp.commonName || `Species ${idx + 1}`}</h3>
                          <button
                            onClick={() => {
                              const newList = [...speciesList];
                              newList[idx].hasInventoryLogged = false;
                              newList[idx].startingLcVolumeMl = 0;
                              newList[idx].sterilizedGrains = [];
                              newList[idx].sterilizedSubstrate = [];
                              setSpeciesList(newList);
                            }}
                            className="text-danger p-1.5 rounded hover:bg-danger-dim transition-colors flex items-center gap-1 text-[12px] font-semibold"
                          >
                            <Trash size={14} /> Clear Inventory
                          </button>
                        </div>

                        {/* LC */}
                        <div>
                          <FieldGroup label={`Liquid Culture (mL)`} hint="1 syringe ≈ 10 mL">
                            <input type="number" min="0" className="lab-input w-full"
                              value={sp.startingLcVolumeMl}
                              onChange={e => {
                                const newList = [...speciesList];
                                newList[idx].startingLcVolumeMl = intVal(e.target.value);
                                setSpeciesList(newList);
                              }} />
                          </FieldGroup>
                        </div>

                        {/* Grain bags */}
                        <div className="bg-surface-900 rounded-lg p-3 border border-surface-border">
                          <div className="flex justify-between items-center mb-3">
                            <p className="text-[13px] font-semibold text-surface-muted">Sterilized Grain Bags</p>
                            <button
                              onClick={() => {
                                const newList = [...speciesList];
                                newList[idx].sterilizedGrains.push({ weightLbs: 5, quantity: 1 });
                                setSpeciesList(newList);
                              }}
                              className="text-[12px] bg-surface-800 px-2.5 py-1 rounded-lg text-bio-green hover:bg-surface-700 transition-colors flex items-center gap-1"
                            >
                              <Plus size={12} weight="bold" /> Add
                            </button>
                          </div>
                          {sp.sterilizedGrains.length === 0 && (
                            <p className="text-[12px] text-surface-muted mb-2">None.</p>
                          )}
                          <div className="space-y-2">
                            {sp.sterilizedGrains.map((item, itemIdx) => (
                              <div key={itemIdx} className="flex gap-2 items-center">
                                <div className="flex items-center bg-surface-800 rounded-lg border border-surface-border overflow-hidden">
                                  <button onClick={() => {
                                    const newList = [...speciesList];
                                    newList[idx].sterilizedGrains[itemIdx].quantity = Math.max(1, item.quantity - 1);
                                    setSpeciesList(newList);
                                  }} className="px-3 py-1 hover:bg-surface-700 font-bold">-</button>
                                  <input type="number" className="bg-transparent w-10 text-center font-bold text-[13px] outline-none"
                                    value={item.quantity} readOnly />
                                  <button onClick={() => {
                                    const newList = [...speciesList];
                                    newList[idx].sterilizedGrains[itemIdx].quantity = item.quantity + 1;
                                    setSpeciesList(newList);
                                  }} className="px-3 py-1 hover:bg-surface-700 font-bold">+</button>
                                </div>
                                <span className="text-[12px] text-surface-muted">bags @</span>
                                <input type="number" className="lab-input w-16 text-center" placeholder="Lbs"
                                  value={item.weightLbs}
                                  onChange={e => {
                                    const newList = [...speciesList];
                                    newList[idx].sterilizedGrains[itemIdx].weightLbs = floatVal(e.target.value);
                                    setSpeciesList(newList);
                                  }} />
                                <span className="text-[12px] text-surface-muted">lbs</span>
                                <button onClick={() => {
                                  const newList = [...speciesList];
                                  newList[idx].sterilizedGrains = sp.sterilizedGrains.filter((_, i) => i !== itemIdx);
                                  setSpeciesList(newList);
                                }} className="text-danger p-1.5 rounded hover:bg-danger-dim ml-auto">
                                  <Trash size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Substrate blocks */}
                        <div className="bg-surface-900 rounded-lg p-3 border border-surface-border">
                          <div className="flex justify-between items-center mb-3">
                            <p className="text-[13px] font-semibold text-surface-muted">Sterilized Substrate Blocks</p>
                            <button
                              onClick={() => {
                                const newList = [...speciesList];
                                newList[idx].sterilizedSubstrate.push({ weightLbs: 5, quantity: 1 });
                                setSpeciesList(newList);
                              }}
                              className="text-[12px] bg-surface-800 px-2.5 py-1 rounded-lg text-bio-green hover:bg-surface-700 transition-colors flex items-center gap-1"
                            >
                              <Plus size={12} weight="bold" /> Add
                            </button>
                          </div>
                          {sp.sterilizedSubstrate.length === 0 && (
                            <p className="text-[12px] text-surface-muted mb-2">None.</p>
                          )}
                          <div className="space-y-2">
                            {sp.sterilizedSubstrate.map((item, itemIdx) => (
                              <div key={itemIdx} className="flex gap-2 items-center">
                                <div className="flex items-center bg-surface-800 rounded-lg border border-surface-border overflow-hidden">
                                  <button onClick={() => {
                                    const newList = [...speciesList];
                                    newList[idx].sterilizedSubstrate[itemIdx].quantity = Math.max(1, item.quantity - 1);
                                    setSpeciesList(newList);
                                  }} className="px-3 py-1 hover:bg-surface-700 font-bold">-</button>
                                  <input type="number" className="bg-transparent w-10 text-center font-bold text-[13px] outline-none"
                                    value={item.quantity} readOnly />
                                  <button onClick={() => {
                                    const newList = [...speciesList];
                                    newList[idx].sterilizedSubstrate[itemIdx].quantity = item.quantity + 1;
                                    setSpeciesList(newList);
                                  }} className="px-3 py-1 hover:bg-surface-700 font-bold">+</button>
                                </div>
                                <span className="text-[12px] text-surface-muted">blocks @</span>
                                <input type="number" className="lab-input w-16 text-center" placeholder="Lbs"
                                  value={item.weightLbs}
                                  onChange={e => {
                                    const newList = [...speciesList];
                                    newList[idx].sterilizedSubstrate[itemIdx].weightLbs = floatVal(e.target.value);
                                    setSpeciesList(newList);
                                  }} />
                                <span className="text-[12px] text-surface-muted">lbs</span>
                                <button onClick={() => {
                                  const newList = [...speciesList];
                                  newList[idx].sterilizedSubstrate = sp.sterilizedSubstrate.filter((_, i) => i !== itemIdx);
                                  setSpeciesList(newList);
                                }} className="text-danger p-1.5 rounded hover:bg-danger-dim ml-auto">
                                  <Trash size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="lab-card p-4">
                  <p className="text-[13px] font-semibold text-surface-muted mb-2">Log Inventory for Species</p>
                  <select
                    className="lab-input w-full"
                    value=""
                    onChange={e => {
                      if (!e.target.value) return;
                      const idx = intVal(e.target.value);
                      const newList = [...speciesList];
                      newList[idx].hasInventoryLogged = true;
                      setSpeciesList(newList);
                    }}
                  >
                    <option value="">+ Select Species...</option>
                    {speciesList.map((s, idx) => {
                      if (s.hasInventoryLogged) return null;
                      return <option key={idx} value={idx}>{s.commonName || `Species ${idx + 1}`}</option>
                    })}
                  </select>
                </div>
              </div>
            )}

            {/* ── STEP 7: INCUBATING ────────────────────────── */}
            {step === 7 && (
              <div className="space-y-4">
                <HelpCard title="Already Colonizing?">
                  Do you have bags that are currently incubating? Add them here so the schedule
                  knows what's already in the pipeline.
                  <br /><br />
                  You can skip this if you're starting fresh.
                </HelpCard>

                <div className="lab-card p-4">
                  <div className="flex justify-between items-center mb-3">
                    <p className="text-[13px] font-semibold text-surface-muted">Incubating Batches</p>
                    <button
                      onClick={() => {
                        if (speciesList.length === 0) return
                        setIncubating(i => [...i, { speciesIdx: 0, stage: 'GEN1_GRAIN', quantity: 1, colonizationPct: 0 }])
                      }}
                      className="text-[12px] bg-surface-800 px-2.5 py-1 rounded-lg text-bio-green hover:bg-surface-700 transition-colors flex items-center gap-1"
                    >
                      <Plus size={12} weight="bold" /> Add Batch
                    </button>
                  </div>

                  {incubating.length === 0 && (
                    <p className="text-[12px] text-surface-muted">None. Skip or add above.</p>
                  )}

                  <div className="space-y-4">
                    {incubating.map((item, idx) => (
                      <div key={idx} className="bg-surface-900 rounded-xl p-3 border border-surface-border space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-semibold text-surface-muted">Batch {idx + 1}</span>
                          <button
                            onClick={() => setIncubating(i => i.filter((_, j) => j !== idx))}
                            className="text-danger p-1.5 rounded hover:bg-danger-dim transition-colors"
                          >
                            <Trash size={14} />
                          </button>
                        </div>

                        {/* Species picker — dynamic from step 3 */}
                        <div>
                          <p className="text-[11px] text-surface-muted mb-1">Species</p>
                          <select
                            className="lab-input w-full"
                            value={item.speciesIdx}
                            onChange={e => setIncubating(i => i.map((it, j) => j === idx ? { ...it, speciesIdx: intVal(e.target.value) } : it))}
                          >
                            {speciesList.map((s, sIdx) => (
                              <option key={sIdx} value={sIdx}>
                                {s.commonName || `Species ${sIdx + 1}`}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {/* Stage */}
                          <div>
                            <p className="text-[11px] text-surface-muted mb-1">Stage</p>
                            <select className="lab-input w-full text-sm"
                              value={item.stage}
                              onChange={e => setIncubating(i => i.map((it, j) => j === idx ? { ...it, stage: e.target.value } : it))}>
                              {speciesList[item.speciesIdx]?.maxGenerations > 0 && (
                                <option value="GEN1_GRAIN">Gen 1 Grain (from LC)</option>
                              )}
                              {Array.from({ length: Math.max(0, (speciesList[item.speciesIdx]?.maxGenerations || 1) - 1) }).map((_, gIdx) => (
                                <option key={gIdx} value={`GEN${gIdx + 2}_GRAIN`}>Gen {gIdx + 2} Grain (G2G)</option>
                              ))}
                              <option value="BULK_BLOCK">Bulk Block</option>
                            </select>
                          </div>
                          {/* Quantity */}
                          <div>
                            <p className="text-[11px] text-surface-muted mb-1">Quantity</p>
                            <input type="number" min="1" className="lab-input w-full text-sm text-center"
                              value={item.quantity}
                              onChange={e => setIncubating(i => i.map((it, j) => j === idx ? { ...it, quantity: intVal(e.target.value) } : it))} />
                          </div>
                        </div>

                        {/* Colonization progress */}
                        <div>
                          <div className="flex justify-between text-[11px] text-surface-muted mb-1">
                            <span>Colonization Progress</span>
                            <span className="text-bio-green font-mono font-bold">{item.colonizationPct}%</span>
                          </div>
                          <input type="range" min="0" max="100"
                            className="w-full accent-bio-green"
                            value={item.colonizationPct}
                            onChange={e => setIncubating(i => i.map((it, j) => j === idx ? { ...it, colonizationPct: intVal(e.target.value) } : it))} />
                          <div className="flex justify-between text-[10px] text-surface-muted">
                            <span>Just started</span><span>Almost done</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {error && (
        <div className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="bg-danger/90 backdrop-blur-sm text-surface-900 font-bold px-4 py-2 rounded-xl text-sm shadow-xl max-w-xl w-full text-center">
            {error}
          </div>
        </div>
      )}

      {/* ── Fixed footer nav (safe-area aware) ────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-surface-900 border-t border-surface-border"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))', paddingTop: '0.75rem', paddingLeft: '1rem', paddingRight: '1rem' }}
      >
        <div className="flex gap-3 max-w-xl mx-auto">
          {step > 1 && (
            <button
              onClick={goBack}
              disabled={isSubmitting}
              className="flex-1 bg-surface-800 text-surface-text font-semibold h-12 rounded-2xl flex items-center justify-center gap-2 hover:bg-surface-700 transition-colors disabled:opacity-50"
            >
              <CaretLeft weight="bold" size={16} /> Back
            </button>
          )}

          {step < 7 ? (
            <button
              onClick={goNext}
              className="flex-[2] bg-bio-green text-surface-900 font-bold h-12 rounded-2xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              Continue <CaretRight weight="bold" size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || speciesList.some(s => !s.commonName.trim())}
              className="flex-[2] bg-bio-green text-surface-900 font-bold h-12 rounded-2xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <SpinnerIcon size={18} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  Launch Lab <Check weight="bold" size={16} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
