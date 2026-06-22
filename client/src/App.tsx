// =============================================================
// Myco Lab — App shell & routing
//
// React Router v6+ (react-router-dom v7 in package.json — same API).
//   1. /            → DailyView       (Step 2)
//   2. /incubating  → IncubatingView  (Step 3)
//   3. /calendar    → WeeklyCalendar  (placeholder)
//   4. /fridge      → FridgeView      (placeholder)
//   5. /lineage     → LineageView     (placeholder)
//   6. /settings    → SettingsView    (placeholder)
//
// The Layout component owns the mobile bottom tab bar and the
// desktop left rail. Both are CSS-driven (md:hidden / hidden md:flex).
// =============================================================

import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { getSettings } from './lib/api'

import { Layout } from './components/Layout'
import DailyView from './views/DailyView'
import IncubatingView from './views/IncubatingView'
import WeeklyCalendar from './views/WeeklyCalendar'
import FridgeView from './views/FridgeView'
import LineageView from './views/LineageView'
import SettingsView from './views/SettingsView'
import OnboardingView from './views/OnboardingView'

function AppController() {
  const [isSetup, setIsSetup] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkSetup = () => {
    getSettings()
      .then(res => setIsSetup(res.isSetup))
      .catch(err => setError(err.message || 'Failed to connect to server'))
  }

  useEffect(() => {
    checkSetup()
  }, [])

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-4 text-center text-danger">
        <p>Error connecting to Myco Lab server: {error}</p>
        <button className="mt-4 px-4 py-2 bg-surface-800 rounded" onClick={checkSetup}>Retry</button>
      </div>
    )
  }

  if (isSetup === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-900">
        <div className="animate-pulse w-8 h-8 rounded-full bg-bio-green opacity-50" />
      </div>
    )
  }

  if (isSetup === false) {
    return <OnboardingView onComplete={() => setIsSetup(true)} />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DailyView />} />
          <Route path="/incubating" element={<IncubatingView />} />
          <Route path="/calendar" element={<WeeklyCalendar />} />
          <Route path="/fridge" element={<FridgeView />} />
          <Route path="/lineage" element={<LineageView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<DailyView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function App() {
  return <AppController />
}

export default App
