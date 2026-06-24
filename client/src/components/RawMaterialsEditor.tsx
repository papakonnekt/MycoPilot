import { useState, useEffect } from 'react'
import {
  Plus,
  Trash,
  PencilSimple,
  Warning,
  Check,
} from 'phosphor-react'
import { createMaterial, updateMaterial, deleteMaterial, getInventory } from '../lib/api'

export function RawMaterialsEditor() {
  const [materials, setMaterials] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  
  // Form state
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('lbs')
  const [qty, setQty] = useState<number>(0)
  const [threshold, setThreshold] = useState<number>(0)
  const [cost, setCost] = useState<number>(0)

  const loadData = async () => {
    try {
      const res = await getInventory()
      setMaterials(res.data.materials)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleEdit = (m: any) => {
    setEditingId(m.id)
    setName(m.material_name)
    setUnit(m.unit)
    setQty(m.quantity_on_hand)
    setThreshold(m.reorder_threshold)
    setCost(m.cost_per_unit || 0)
  }

  const handleCancel = () => {
    setEditingId(null)
    setName('')
    setUnit('lbs')
    setQty(0)
    setThreshold(0)
    setCost(0)
  }

  const handleSave = async () => {
    if (!name.trim()) return
    try {
      if (editingId) {
        await updateMaterial(editingId, {
          materialName: name,
          unit,
          quantityOnHand: qty,
          reorderThreshold: threshold,
          costPerUnit: cost,
        })
      } else {
        await createMaterial({
          materialName: name,
          unit,
          quantityOnHand: qty,
          reorderThreshold: threshold,
          costPerUnit: cost,
        })
      }
      handleCancel()
      loadData()
    } catch (e) {
      console.error(e)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this material?')) return
    try {
      await deleteMaterial(id)
      loadData()
    } catch (e) {
      alert('Could not delete material. It might be used in recipes or transactions.')
    }
  }

  if (loading) return <div className="p-4 text-center text-slate-500">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-100">Raw Materials</h3>
        <button
          onClick={() => { handleCancel(); setEditingId(-1); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors"
        >
          <Plus weight="bold" /> Add Material
        </button>
      </div>

      {editingId === -1 && (
        <div className="bg-slate-800 p-4 rounded-xl border border-emerald-500/30 mb-4 shadow-lg shadow-emerald-500/10">
          <h4 className="text-sm font-semibold text-emerald-400 mb-3">New Material</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200" placeholder="e.g. Soy Hulls" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Unit</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200" placeholder="e.g. lbs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Stock Qty</label>
              <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Cost / Unit ($)</label>
              <input type="number" step="0.01" value={cost} onChange={e => setCost(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={handleCancel} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-300">Cancel</button>
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"><Check /> Save Material</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {materials.map(m => (
          <div key={m.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            {editingId === m.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={name} onChange={e => setName(e.target.value)} className="col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Unit</label>
                    <input value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Cost / Unit</label>
                    <input type="number" step="0.01" value={cost} onChange={e => setCost(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Threshold</label>
                    <input type="number" value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Current Stock</label>
                    <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200" />
                  </div>
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
                    <h4 className="font-semibold text-slate-200">{m.material_name}</h4>
                    <p className="text-xs text-slate-500">Cost: ${m.cost_per_unit?.toFixed(2) || '0.00'} / {m.unit}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleEdit(m)} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-700 rounded"><PencilSimple /></button>
                    <button onClick={() => handleDelete(m.id)} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-700 rounded"><Trash /></button>
                  </div>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2 bg-slate-900/50 p-2 rounded-lg">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">In Stock</div>
                    <div className={`text-lg font-bold ${m.is_low ? 'text-amber-400' : 'text-slate-300'}`}>{m.quantity_on_hand} <span className="text-xs font-normal text-slate-500">{m.unit}</span></div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Alert Level</div>
                    <div className="text-lg font-bold text-slate-400">{m.reorder_threshold} <span className="text-xs font-normal text-slate-500">{m.unit}</span></div>
                  </div>
                </div>
                {m.is_low && (
                  <div className="mt-2 text-xs flex items-center gap-1 text-amber-400 bg-amber-400/10 px-2 py-1 rounded">
                    <Warning weight="fill" /> Low stock alert
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
