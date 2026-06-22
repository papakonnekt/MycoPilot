// =============================================================
// HelpTooltip — tap-to-reveal info popover
//
// Mobile-first: tapping the ? icon opens a small card anchored
// near the icon. Tapping anywhere outside dismisses it.
// Uses a portal so it's never clipped by overflow:hidden parents.
// =============================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Question } from 'phosphor-react'

interface HelpTooltipProps {
  /** The explanation text shown when the icon is tapped. */
  text: string
  /** Optional title shown in bold above the text. */
  title?: string
}

export function HelpTooltip({ text, title }: HelpTooltipProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const toggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      // Place popover above the icon, centered, clamped to viewport
      const popW = 260
      let left = rect.left + rect.width / 2 - popW / 2
      left = Math.max(12, Math.min(left, window.innerWidth - popW - 12))
      setPos({ top: rect.top - 8, left })
    }
    setOpen((v) => !v)
  }

  // Close on outside tap
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Help"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-bio-green/60 hover:text-bio-green hover:bg-bio-green/10 transition-colors duration-200 shrink-0"
      >
        <Question size={13} weight="bold" />
      </button>

      {open &&
        createPortal(
          <div
            role="tooltip"
            aria-live="polite"
            onPointerDown={(e) => e.stopPropagation()}
            className="help-popover"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: 260,
              transform: 'translateY(-100%)',
              zIndex: 9999,
            }}
          >
            <div className="help-popover-shell">
              {title && (
                <p className="text-[11px] font-semibold text-bio-green uppercase tracking-wider mb-1">
                  {title}
                </p>
              )}
              <p className="text-[13px] leading-snug text-surface-text/90">{text}</p>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
