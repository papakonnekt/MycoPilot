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

import { BrowserRouter, Routes, Route } from 'react-router-dom'

import { Layout } from './components/Layout'
import DailyView from './views/DailyView'
import IncubatingView from './views/IncubatingView'
import WeeklyCalendar from './views/WeeklyCalendar'
import FridgeView from './views/FridgeView'
import LineageView from './views/LineageView'
import SettingsView from './views/SettingsView'

function App() {
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

export default App
