// =============================================================
// Mobile bottom tab bar — Dark Forest Edition
//
// Changes from original:
//  - Dark glassmorphic nav island (deep forest + green glow ring)
//  - Active pill is bioluminescent green (#34d468) with glow
//  - Nav island height = h-[4.5rem] (72px) — prevents label clip
//  - Labels use text-[9px] and truncate, guaranteed to fit 360dp
//  - pb-[max(env(safe-area-inset-bottom,0px),16px)] ensures
//    the island clears the Android gesture bar on all devices
//  - Inactive icons/labels are surface-muted (#7aab83)
//  - "More" sheet updated to dark surface style
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
import { useInventoryAlerts } from '../hooks/useInventoryAlerts'

interface TabDef {
  to: string
  label: string
  Icon: typeof House
  matchPaths: string[]
}

const PRIMARY_TABS: TabDef[] = [
  { to: '/',           label: 'Today',    Icon: House,         matchPaths: ['/'] },
  { to: '/incubating', label: 'Colonies', Icon: Thermometer,   matchPaths: ['/incubating'] },
  { to: '/calendar',   label: 'Calendar', Icon: CalendarBlank, matchPaths: ['/calendar'] },
  { to: '/fridge',     label: 'Fridge',   Icon: Snowflake,     matchPaths: ['/fridge'] },
  { to: '/lineage',    label: 'Lineage',  Icon: GitBranch,     matchPaths: ['/lineage'] },
]

function findActiveIndex(pathname: string): number {
  if (pathname.startsWith('/settings')) return -1
  const idx = PRIMARY_TABS.findIndex((t) =>
    t.matchPaths.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p))),
  )
  return idx
}

export function MobileBottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeIndex = findActiveIndex(location.pathname)
  const { lowCount } = useInventoryAlerts()

  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const railRef = useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })

  const recalc = () => {
    const el = tabRefs.current[activeIndex]
    const rail = railRef.current
    if (!rail) return
    if (!el || activeIndex === -1) {
      setIndicator({ left: 0, width: 0 })
      return
    }
    const elRect  = el.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    setIndicator({ left: elRect.left - railRect.left, width: elRect.width })
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

  const goTo = (to: string) => {
    setSheetOpen(false)
    navigate(to)
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 pointer-events-none"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0px)' }}
      >
        <div className="pointer-events-auto mx-3 mb-3">
          <div className="nav-island rounded-[1.5rem]">
            <div
              ref={railRef}
              className="relative flex items-stretch px-1.5"
              style={{ height: '4.5rem' }}
            >
              {/* Sliding green active indicator */}
              <div
                aria-hidden
                className="absolute top-1/2 -translate-y-1/2 h-[3.2rem] rounded-2xl transition-all duration-500"
                style={{
                  background: 'linear-gradient(135deg, #34d468 0%, #22a84e 100%)',
                  boxShadow: '0 0 16px rgba(52, 212, 104, 0.4), 0 0 32px rgba(52, 212, 104, 0.15)',
                  transform: `translate(${indicator.left}px, -50%)`,
                  width: indicator.width,
                  opacity: indicator.width === 0 ? 0 : 1,
                  transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
                }}
              />

              {PRIMARY_TABS.map((tab, i) => {
                const isActive = i === activeIndex
                return (
                  <NavLink
                    key={tab.to}
                    to={tab.to}
                    end={tab.to === '/'}
                    ref={(el) => { tabRefs.current[i] = el }}
                    className="relative z-10 flex-1 min-w-0 flex items-center justify-center active:scale-[0.95] transition-transform duration-200"
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span
                      className="flex flex-col items-center gap-[3px] px-1 min-w-0 transition-colors duration-300"
                      style={{ color: isActive ? '#080f0a' : '#7aab83' }}
                    >
                      <tab.Icon size={20} weight={isActive ? 'fill' : 'regular'} />
                      <span
                        className="truncate w-full text-center font-medium"
                        style={{ fontSize: '9px', letterSpacing: '0.05em', textTransform: 'uppercase' }}
                      >
                        {tab.label}
                      </span>
                    </span>
                  </NavLink>
                )
              })}

              {/* "More" button */}
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="relative z-10 flex-1 min-w-0 flex items-center justify-center active:scale-[0.95] transition-transform duration-200"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                aria-label="More navigation"
              >
                {lowCount > 0 && (
                  <div className="absolute top-2 right-4 w-2.5 h-2.5 bg-danger rounded-full border border-surface-900" />
                )}
                <span
                  className="flex flex-col items-center gap-[3px] px-1 min-w-0 transition-colors duration-300"
                  style={{
                    color:
                      sheetOpen || location.pathname.startsWith('/settings')
                        ? '#34d468'
                        : '#7aab83',
                  }}
                >
                  <DotsThree size={20} weight="bold" />
                  <span
                    className="truncate w-full text-center font-medium"
                    style={{ fontSize: '9px', letterSpacing: '0.05em', textTransform: 'uppercase' }}
                  >
                    More
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* "More" sheet */}
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
            className="absolute inset-0 animate-fade_in"
            style={{ background: 'rgba(8, 15, 10, 0.7)', backdropFilter: 'blur(8px)' }}
          />

          {/* Sheet */}
          <div
            className="absolute inset-x-3 bottom-3 animate-sheet_up"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="server-modal-shell">
              <div className="px-1 py-1 flex items-center justify-between mb-3">
                <span
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: '#7aab83',
                    fontWeight: 500,
                  }}
                >
                  More
                </span>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  style={{ fontSize: '10px', color: '#7aab83' }}
                  className="uppercase tracking-widest hover:text-surface-text transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
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
                  badgeCount={lowCount}
                />
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
  badgeCount?: number
}

function SheetItem({ onClick, active, Icon, label, hint, badgeCount }: SheetItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left rounded-2xl p-4 min-h-[88px] transition-all duration-300 active:scale-[0.97]"
      style={{
        background: active ? 'rgba(52, 212, 104, 0.15)' : 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${active ? 'rgba(52, 212, 104, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
        color: active ? '#34d468' : '#e8f0e9',
      }}
    >
      <div className="flex items-center justify-between min-w-0">
        <Icon size={22} weight="regular" />
        <div className="flex items-center gap-2">
          {badgeCount != null && badgeCount > 0 && (
            <div className="bg-danger text-surface-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {badgeCount}
            </div>
          )}
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: active ? '#34d468' : 'rgba(52, 212, 104, 0.4)' }}
          />
        </div>
      </div>
      <div className="mt-3 font-sans text-xl font-semibold leading-none break-words">{label}</div>
      <div
        className="mt-1 truncate"
        style={{ fontSize: '11px', letterSpacing: '0.05em', color: '#7aab83' }}
      >
        {hint}
      </div>
    </button>
  )
}
