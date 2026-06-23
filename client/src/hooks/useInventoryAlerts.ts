import { useCallback, useEffect, useState } from 'react'
import { getInventory } from '../lib/api'

export function useInventoryAlerts() {
  const [lowCount, setLowCount] = useState(0)

  const check = useCallback(async () => {
    try {
      const data = await getInventory()
      const lowMaterials = data.materials.filter((m) => m.is_low)
      const lowLc = data.lcStatus.filter((s) => s.lc_is_low)
      setLowCount(lowMaterials.length + lowLc.length)
    } catch (err) {
      // fail silently
    }
  }, [])

  useEffect(() => {
    void check()
    // Poll every 5 minutes
    const t = setInterval(check, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [check])

  return { lowCount }
}
