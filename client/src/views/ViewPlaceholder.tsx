// =============================================================
// Shared placeholder shell used by every view in Step 1.
//
// Mobile-overhaul changes:
//  - H1 down to text-3xl/6xl so it fits on a 360dp screen.
//  - Build-hints grid is grid-cols-1 sm:grid-cols-2 (was the
//    reverse — sm:grid-cols-2 caused squeeze on small viewports).
//  - Each hint chip uses min-w-0 + break-words so long strings
//    wrap inside the chip rather than overflowing.
// =============================================================

import type { ReactNode } from 'react'

export interface ViewPlaceholderProps {
  eyebrow: string
  title: string
  subtitle: string
  step: 'Step 2' | 'Step 3' | 'Future'
  buildHints?: string[]
  children?: ReactNode
}

export function ViewPlaceholder({
  eyebrow,
  title,
  subtitle,
  step,
  buildHints = [],
}: ViewPlaceholderProps) {
  return (
    <div className="bezel-shell">
      <div className="bezel-core p-5 sm:p-8 md:p-10 min-w-0">
        <div className="flex items-center justify-between gap-4 flex-wrap min-w-0">
          <span className="eyebrow-tag">{eyebrow}</span>
          <span className="text-[10px] uppercase tracking-eyebrow text-ink/40">
            {step}
          </span>
        </div>

        <h1 className="mt-5 md:mt-6 font-serif text-3xl sm:text-5xl md:text-6xl leading-[0.95] tracking-tight text-ink text-balance break-words">
          {title}
        </h1>

        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-graphite-500 break-words">
          {subtitle}
        </p>

        <hr className="hairline my-7 md:my-8" />

        {buildHints.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            {buildHints.map((hint) => (
              <div
                key={hint}
                className="rounded-2xl bg-black/[0.025] ring-1 ring-black/5 px-4 py-3 text-[13px] text-graphite-600 break-words min-w-0"
              >
                {hint}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 md:mt-10 flex items-center gap-3 text-[11px] uppercase tracking-eyebrow text-ink/40">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-700" />
          <span>Shell ready — content lands in {step.toLowerCase()}</span>
        </div>
      </div>
    </div>
  )
}
