import { useState, useEffect } from 'react'
import {
  Plus,
  Trash,
  PencilSimple,
  Check,
} from 'phosphor-react'
import { createRecipe, updateRecipe, deleteRecipe, getRecipes, getInventory } from '../lib/api'

export function RecipesEditor() {
  const [recipes, setRecipes] = useState<any[]>([])
  const [materials, setMaterials] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  
  // Form state
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [ingredients, setIngredients] = useState<any[]>([])

  const loadData = async () => {
    try {
      const [resR, resM] = await Promise.all([getRecipes(), getInventory()])
      setRecipes(resR.data || [])
      setMaterials(resM.data.materials || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleEdit = (r: any) => {
    setEditingId(r.id)
    setName(r.name)
    setNotes(r.notes || '')
    setIngredients(r.ingredients || [])
  }

  const handleCancel = () => {
    setEditingId(null)
    setName('')
    setNotes('')
    setIngredients([])
  }

  const handleSave = async () => {
    if (!name.trim()) return
    try {
      if (editingId) {
        await updateRecipe(editingId, { name, notes, ingredients })
      } else {
        await createRecipe({ name, notes, ingredients })
      }
      handleCancel()
      loadData()
    } catch (e) {
      console.error(e)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this recipe?')) return
    try {
      await deleteRecipe(id)
      loadData()
    } catch (e) {
      alert('Could not delete recipe.')
    }
  }

  const addIngredient = () => {
    setIngredients([...ingredients, { ingredient: '', amount: 0, unit: '%' }])
  }

  const updateIngredient = (index: number, field: string, value: any) => {
    const newIngs = [...ingredients]
    newIngs[index] = { ...newIngs[index], [field]: value }
    setIngredients(newIngs)
  }

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  if (loading) return <div className="p-4 text-center text-slate-500">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-100">Substrate Recipes</h3>
        <button
          onClick={() => { handleCancel(); setEditingId(-1); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
        >
          <Plus weight="bold" /> New Recipe
        </button>
      </div>

      {editingId === -1 && (
        <div className="bg-slate-800 p-4 rounded-xl border border-emerald-500/30 mb-4 shadow-lg shadow-emerald-500/10">
          <h4 className="text-sm font-semibold text-emerald-400 mb-3">New Recipe</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Recipe Name</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200" placeholder="e.g. Masters Mix (50/50)" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200" placeholder="e.g. 60% hydration" />
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-slate-400">Ingredients</label>
              <button onClick={addIngredient} className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><Plus /> Add item</button>
            </div>
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={ing.ingredient} onChange={e => updateIngredient(i, 'ingredient', e.target.value)} placeholder="Material Name" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  <input type="number" value={ing.amount} onChange={e => updateIngredient(i, 'amount', Number(e.target.value))} className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  <input value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} placeholder="%" className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  <button onClick={() => removeIngredient(i)} className="p-2 text-slate-500 hover:text-rose-400"><Trash /></button>
                </div>
              ))}
              {ingredients.length === 0 && <div className="text-xs text-slate-500 italic">No ingredients added.</div>}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={handleCancel} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-300">Cancel</button>
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"><Check /> Save Recipe</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recipes.map(r => (
          <div key={r.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            {editingId === r.id ? (
              <div className="space-y-3">
                <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" placeholder="Notes" />
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
                    <span>Ingredients</span>
                    <button onClick={addIngredient} className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><Plus /> Add</button>
                  </div>
                  {ingredients.map((ing, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={ing.ingredient} onChange={e => updateIngredient(i, 'ingredient', e.target.value)} placeholder="Material Name" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-200" />
                      <input type="number" value={ing.amount} onChange={e => updateIngredient(i, 'amount', Number(e.target.value))} className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-200" />
                      <input value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} placeholder="%" className="w-12 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-200" />
                      <button onClick={() => removeIngredient(i)} className="text-slate-500 hover:text-rose-400"><Trash size={16}/></button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={handleCancel} className="text-xs text-slate-400 px-3 py-1 hover:text-slate-200">Cancel</button>
                  <button onClick={handleSave} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-500">Save</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-slate-200">{r.name}</h4>
                    {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleEdit(r)} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-700 rounded"><PencilSimple /></button>
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-700 rounded"><Trash /></button>
                  </div>
                </div>
                <div className="mt-2 bg-slate-900/50 p-2 rounded-lg space-y-1">
                  {r.ingredients?.length > 0 ? r.ingredients.map((ing: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-slate-300">{ing.ingredient}</span>
                      <span className="text-slate-500">{ing.amount} {ing.unit}</span>
                    </div>
                  )) : (
                    <div className="text-xs text-slate-500 italic">No ingredients defined</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
