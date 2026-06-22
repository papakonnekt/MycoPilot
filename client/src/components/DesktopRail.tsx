// =============================================================
// Desktop left rail navigation
//
//  - w-64, full-height, padded p-6
//  - Brand mark (inline SVG) at top
//  - Vertical stack of 6 nav items, each h-11 rounded-2xl
//  - Sliding-pill active indicator (transform-only)
//  - Footer: "v0.1 — Lab Build" in 10px tracked text
// =============================================================

import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  House,
  Thermometer,
  CalendarBlank,
  Snowflake,
  GitBranch,
  GearSix,
} from 'phosphor-react'
import { BrandGlyph } from './BrandGlyph'

interface RailItem {
  to: string
  label: string
  Icon: typeof House
  end?: boolean
}

const RAIL_ITEMS: RailItem[] = [
  { to: '/',           label: 'Today',      Icon: House,        end: true },
  { to: '/incubating', label: 'Incubating', Icon: Thermometer },
  { to: '/calendar',   label: 'Calendar',   Icon: CalendarBlank },
  { to: '/fridge',     label: 'Fridge',     Icon: Snowflake },
  { to: '/lineage',    label: 'Lineage',    Icon: GitBranch },
  { to: '/settings',   label: 'Settings',   Icon: GearSix },
]

function findActiveIndex(pathname: string): number {
  const idx = RAIL_ITEMS.findIndex((item) => {
    if (item.end) return pathname === item.to
    return pathname === item.to || pathname.startsWith(item.to + '/')
  })
  return idx === -1 ? 0 : idx
}

export function DesktopRail() {
  const location = useLocation()
  const activeIndex = findActiveIndex(location.pathname)
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const listRef = useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = useState<{ top: number; height: number }>({
    top: 0,
    height: 44,
  })

  const recalc = () => {
    const el = itemRefs.current[activeIndex]
    const list = listRef.current
    if (!el || !list) return
    const elRect = el.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    setIndicator({
      top: elRect.top - listRect.top,
      height: elRect.height,
    })
  }

  useLayoutEffect(() => {
    recalc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex fixed inset-y-0 left-0 w-64 flex-col p-6 z-30"
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <span className="text-moss-700">
          <BrandGlyph size={28} />
        </span>
        <div className="leading-tight">
          <div className="font-serif text-xl tracking-tight text-ink">Myco Lab</div>
          <div className="text-[10px] uppercase tracking-eyebrow text-ink/40">
            Cultivation Bench
          </div>
        </div>
      </div>

      {/* Section label */}
      <div className="mt-10 mb-3 px-3 text-[10px] uppercase tracking-eyebrow text-ink/40">
        Workspace
      </div>

      {/* Nav list with sliding pill */}
      <div ref={listRef} className="relative flex flex-col">
        <div
          aria-hidden
          className="absolute left-0 right-0 rounded-2xl bg-moss-700 transition-all duration-550 ease-fluid"
          style={{
            transform: `translateY(${indicator.top}px)`,
            height: indicator.height,
          }}
        />
        {RAIL_ITEMS.map((item, i) => {
          const isActive = i === activeIndex
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              className="relative z-10 h-11 rounded-2xl flex items-center gap-3 px-3 my-0.5"
              aria-current={isActive ? 'page' : undefined}
            >
              <item.Icon
                size={20}
                weight={isActive ? 'fill' : 'regular'}
                className={
                  'transition-colors duration-450 ease-fluid ' +
                  (isActive ? 'text-white' : 'text-graphite-500')
                }
              />
              <span
                className={
                  'text-[14px] transition-colors duration-450 ease-fluid ' +
                  (isActive ? 'text-white font-medium' : 'text-graphite-600')
                }
              >
                {item.label}
              </span>
            </NavLink>
          )
        })}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-6">
        <div className="hairline mb-4" />
        <div className="px-3 text-[10px] uppercase tracking-eyebrow text-black/40">
          v0.1 — Lab Build
        </div>
      </div>
    </aside>
  )
}
