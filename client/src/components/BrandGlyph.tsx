// =============================================================
// Myco Lab — Brand mark
// A geometric mushroom silhouette drawn in inline SVG with
// currentColor, intentionally NOT an emoji and NOT a stock icon.
//
// Composition (24×24 viewBox):
//   - A wide low-arc cap (mushroom head)
//   - A solid stem underneath
//   - Two minimal gill strokes (lab-precision, not cute)
// =============================================================

export interface BrandGlyphProps {
  className?: string
  size?: number
  title?: string
}

export function BrandGlyph({ className, size = 28, title = 'Myco Lab' }: BrandGlyphProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Cap — low wide arc, like a specimen jar lid */}
      <path
        d="M3.25 12.5C3.25 8.5 7 5.5 12 5.5C17 5.5 20.75 8.5 20.75 12.5C20.75 13.05 20.3 13.5 19.75 13.5H4.25C3.7 13.5 3.25 13.05 3.25 12.5Z"
        fill="currentColor"
      />
      {/* Stem — tapered square */}
      <path
        d="M9.5 13.5H14.5L13.75 19.5C13.7 20.05 13.25 20.5 12.7 20.5H11.3C10.75 20.5 10.3 20.05 10.25 19.5L9.5 13.5Z"
        fill="currentColor"
        opacity="0.85"
      />
      {/* Gill lines — two fine strokes for the lab-notebook feel */}
      <path
        d="M6.5 11.5H17.5"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M8 9.5H16"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="round"
        opacity="0.25"
      />
    </svg>
  )
}
