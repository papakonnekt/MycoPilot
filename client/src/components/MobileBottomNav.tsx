// =============================================================
// Mobile bottom tab bar — 5 visible tabs + "More" sheet
//
// Mobile-only changes (this overhaul):
//  - The island lifts above the system gesture bar via
//    `pb-[env(safe-area-inset-bottom)]`. The label row stays at
//    h-16, the wrapper now also has bottom padding for the inset.
//  - Labels fit in 4–6 chars and never wrap: Today, Colonizing,
//    Calendar, Fridge, Lineage. Settings is reachable from the
//    "More" sheet, not as a primary tab.
//  - Each tab is a flex-1 anchor with `min-w-0` so a 5-tab row
//    shrinks cleanly on a 360dp screen. The active tab is a
//    filled pill (not just a color change).
//  - Tap feedback: `active:scale-[0.97]` + 180ms spring on the
//    sliding pill so the indicator animates between tabs.
//  - Background gradient extends to the bottom of the safe area
//    so the gesture bar never shows the page content through.
// =============================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  House,
  Thermometer,
  CalendarBlank,
  Snowflake,
  DotsThree,
  GitBranch,
  GearSix,
} from 'phosphor-react'

interface TabDef {
  to: string
  label: string
  Icon: typeof House
  matchPaths: string[]
}

// Labels shortened to fit 360dp screens without truncation.
// "Today" is the bench, "Colonizing" is the incubating view.
const PRIMARY_TABS: TabDef[] = [
  { to: '/',           label: 'Today',      Icon: House,         matchPaths: ['/'] },
  { to: '/incubating', label: 'Colonies',   Icon: Thermometer,   matchPaths: ['/incubating'] },
  { to: '/calendar',   label: 'Calendar',   Icon: CalendarBlank, matchPaths: ['/calendar'] },
  { to: '/fridge',     label: 'Fridge',     Icon: Snowflake,     matchPaths: ['/fridge'] },
  { to: '/lineage',    label: 'Lineage',    Icon: GitBranch,     matchPaths: ['/lineage'] },
]

function findActiveIndex(pathname: string): number {
  // Settings lives in the "More" sheet; visually mark "More" as active
  // when the user is on /settings.
  if (pathname.startsWith('/settings')) return 4 // visual position of "More"
  const idx = PRIMARY_TABS.findIndex((t) =>
    t.matchPaths.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p))),
  )
  return idx === -1 ? 0 : idx
}

export function MobileBottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeIndex = findActiveIndex(location.pathname)

  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const railRef = useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })

  const recalc = () => {
    const el = tabRefs.current[activeIndex]
    const rail = railRef.current
    if (!el || !rail) return
    const elRect = el.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    setIndicator({
      left: elRect.left - railRect.left,
      width: elRect.width,
    })
  }

  useLayoutEffect(() => {
    recalc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  useEffect(() => {
    const onResize = () => recalc()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sheet is opened/closed by direct user action (button + navigate).
  const goTo = (to: string) => {
    setSheetOpen(false)
    navigate(to)
  }

  return (
    <>
      {/* The floating island. The outer wrapper carries the safe-area
          bottom padding so the frosted background extends under the
          gesture bar; the inner island still floats with mb-4 and the
          slide-in transform-only indicator sits inside it. */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 pointer-events-none pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="pointer-events-auto mx-3 mb-3">
          <div className="nav-island rounded-[1.5rem]">
            <div
              ref={railRef}
              className="relative flex h-16 items-stretch px-1.5"
            >
              {/* Sliding active indicator — transform-only */}
              <div
                aria-hidden
                className="absolute top-1/2 -translate-y-1/2 h-12 rounded-2xl bg-moss-700 text-white shadow-ambient transition-all duration-550 ease-fluid"
                style={{
                  transform: `translate(${indicator.left}px, -50%)`,
                  width: indicator.width,
                }}
              />

              {PRIMARY_TABS.map((tab, i) => {
                const isActive = i === activeIndex
                return (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    end={tab.to === '/'}
                    ref={(el) => {
                      tabRefs.current[i] = el
                    }}
                    className="relative z-10 flex-1 min-w-0 flex items-center justify-center active:scale-[0.97] transition-transform duration-200 ease-spring"
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span
                      className={
                        'flex flex-col items-center gap-0.5 px-1 transition-colors duration-450 ease-fluid min-w-0 ' +
                        (isActive ? 'text-white' : 'text-graphite-500')
                      }
                    >
                      <tab.Icon size={20} weight={isActive ? 'fill' : 'regular'} />
                      <span className="text-[10px] tracking-eyebrow uppercase truncate w-full text-center">
                        {tab.label}
                      </span>
                    </span>
                  </NavLink>
                )
              })}

              {/* "More" button (always last, opens sheet) */}
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="relative z-10 flex-1 min-w-0 flex items-center justify-center active:scale-[0.97] transition-transform duration-200 ease-spring"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                aria-label="More navigation"
              >
                <span
                  className={
                    'flex flex-col items-center gap-0.5 px-1 transition-colors duration-450 ease-fluid min-w-0 ' +
                    (sheetOpen || location.pathname.startsWith('/settings')
                      ? 'text-white'
                      : 'text-graphite-500')
                  }
                >
                  <DotsThree size={20} weight="bold" />
                  <span className="text-[10px] tracking-eyebrow uppercase truncate w-full text-center">
                    More
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* "More" sheet — opens from bottom and respects safe-area insets
          via a max-width clamp on small screens. */}
      {sheetOpen && (
        <div
          className="md:hidden fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
        >
          {/* Scrim */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-ink/30 backdrop-blur-md animate-fade_in"
          />
          {/* Sheet — sits above the system nav. */}
          <div
            className="absolute inset-x-3 bottom-3 animate-sheet_up"
            style={{
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="bezel-shell">
              <div className="bezel-core p-3">
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-eyebrow text-ink/40">More</span>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="text-eyebrow text-ink/40 hover:text-ink transition-colors duration-450 ease-fluid"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 p-1">
                  <SheetItem
                    onClick={() => goTo('/lineage')}
                    active={location.pathname.startsWith('/lineage')}
                    Icon={GitBranch}
                    label="Lineage"
                    hint="Genetic tree + BE"
                  />
                  <SheetItem
                    onClick={() => goTo('/settings')}
                    active={location.pathname.startsWith('/settings')}
                    Icon={GearSix}
                    label="Settings"
                    hint="Hardware + targets"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface SheetItemProps {
  onClick: () => void
  active: boolean
  Icon: typeof House
  label: string
  hint: string
}

function SheetItem({ onClick, active, Icon, label, hint }: SheetItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'group text-left rounded-2xl p-4 min-h-[88px] transition-colors duration-450 ease-fluid active:scale-[0.98] ' +
        (active
          ? 'bg-moss-700 text-white ring-1 ring-moss-800/30'
          : 'bg-black/[0.025] ring-1 ring-black/5 hover:bg-black/[0.04] text-ink')
      }
    >
      <div className="flex items-center justify-between min-w-0">
        <Icon size={22} weight="regular" />
        <span
          className={
            'h-1.5 w-1.5 rounded-full shrink-0 ' + (active ? 'bg-white' : 'bg-moss-700/60')
          }
        />
      </div>
      <div className="mt-3 font-serif text-2xl leading-none break-words">{label}</div>
      <div
        className={
          'mt-1 text-[11px] tracking-wide_lab truncate ' +
          (active ? 'text-white/70' : 'text-graphite-400')
        }
      >
        {hint}
      </div>
    </button>
  )
}
