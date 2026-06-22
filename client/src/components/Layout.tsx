// =============================================================
// Layout — wraps every route with the correct navigation context
// and a content surface that respects the floating bottom bar.
//
// Mobile  : <main> sits above the bottom tab bar and respects the
//          Android system gesture inset via pb-[env(safe-area-inset-bottom)].
//          Sticky mobile header inside the scroll area handles the
//          top safe area.
// Desktop : <main> offsets by the 16rem rail width (unchanged).
//
// The root element carries the .app-shell class which owns the
// side safe-area insets (notches / curved edges). The body keeps
// its grain background but no longer claims padding for insets —
// the shell does.
// =============================================================

import { Outlet } from 'react-router-dom'
import { MobileBottomNav } from './MobileBottomNav'
import { DesktopRail } from './DesktopRail'

export function Layout() {
  return (
    <div className="app-shell min-h-[100dvh]">
      <DesktopRail />

      {/* Content surface. Padded to clear the floating bottom tab on mobile
          (including the Android system gesture bar) and the fixed left
          rail on desktop. The mobile column gets its own scroll context
          (the page itself scrolls on mobile; desktop is a fixed column). */}
      <main
        className="
          px-4 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1rem)] pb-[calc(4.5rem+max(env(safe-area-inset-bottom,0px),16px)+1.5rem)]
          md:pl-[calc(16rem+1.5rem)] md:pr-8 md:pt-10 md:pb-12
          animate-rise_in
        "
      >
        <div className="mx-auto w-full max-w-5xl min-w-0">
          <Outlet />
        </div>
      </main>

      <MobileBottomNav />
    </div>
  )
}
