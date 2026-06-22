// =============================================================
// Layout — wraps every route with the correct navigation context
// and a content surface that respects the floating bottom bar.
//
// Mobile  : <main> sits above the bottom tab bar (pb-28)
// Desktop : <main> offsets by the 16rem rail width
// =============================================================

import { Outlet } from 'react-router-dom'
import { MobileBottomNav } from './MobileBottomNav'
import { DesktopRail } from './DesktopRail'

export function Layout() {
  return (
    <div className="min-h-[100dvh]">
      <DesktopRail />

      {/* Content surface. Padded to clear the floating bottom tab on mobile
          and the fixed left rail on desktop. */}
      <main
        className="
          px-4 pt-6 pb-28
          md:pl-[calc(16rem+1.5rem)] md:pr-8 md:pt-10 md:pb-12
          animate-rise_in
        "
      >
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>

      <MobileBottomNav />
    </div>
  )
}
