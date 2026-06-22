/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark forest surface palette ─────────────────────
        surface: {
          900: '#080f0a',
          800: '#0c1a10',
          700: '#111d15',
          600: '#182a1c',
          500: '#1e3522',
          text: '#e8f0e9',
          muted: '#7aab83',
          border: 'rgba(52, 212, 104, 0.10)',
          hairline: 'rgba(255, 255, 255, 0.06)',
        },
        // ── Bioluminescent green accent ─────────────────────
        'bio-green': {
          DEFAULT: '#34d468',
          dim: 'rgba(52, 212, 104, 0.15)',
        },
        // ── Legacy palette kept for gradual migration ───────
        paper: '#F5F4F0',
        ink: '#0A0A0A',
        moss: {
          50:  '#EEF3EC',
          100: '#D6E2D1',
          200: '#A8C29E',
          300: '#7AA16C',
          400: '#4C7E45',
          500: '#2F5C2A',
          600: '#234A20',
          700: '#1F3D2B',
          800: '#162B1D',
          900: '#0E1B12',
        },
        graphite: {
          400: '#6B6B6B',
          500: '#4A4A4A',
          600: '#2A2A2A',
        },
        amber_lab: '#B97A1F',
        rose_lab:  '#A3362C',
      },
      fontFamily: {
        sans:  ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', '"PP Editorial New"', 'ui-serif', 'Georgia', 'serif'],
        mono:  ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        squircle:    '1.75rem',
        squircle_lg: '2.25rem',
      },
      boxShadow: {
        ambient:          '0 1px 1px rgba(0,0,0,0.1), 0 8px 24px -12px rgba(0,0,0,0.3), 0 24px 60px -24px rgba(0,0,0,0.2)',
        ambient_lg:       '0 1px 1px rgba(0,0,0,0.15), 0 16px 48px -16px rgba(0,0,0,0.4)',
        bezel_inner:      'inset 0 1px 1px rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3)',
        bezel_inner_dark: 'inset 0 1px 1px rgba(255,255,255,0.04)',
        glow_green:       '0 0 20px rgba(52,212,104,0.25), 0 0 40px rgba(52,212,104,0.10)',
      },
      transitionTimingFunction: {
        fluid:  'cubic-bezier(0.32, 0.72, 0, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '450': '450ms',
        '550': '550ms',
        '700': '700ms',
      },
      letterSpacing: {
        eyebrow:  '0.2em',
        wide_lab: '0.08em',
      },
      spacing: {
        'safe-top':    'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left':   'env(safe-area-inset-left, 0px)',
        'safe-right':  'env(safe-area-inset-right, 0px)',
        // Nav island: h-[4.5rem] = 72px body + safe area below
        'nav-h':      '4.5rem',
        'nav-h-safe': 'calc(4.5rem + env(safe-area-inset-bottom, 16px) + 0.75rem)',
        'header-h':   '4rem',
      },
      keyframes: {
        rise_in: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fade_in: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        sheet_up: {
          '0%':   { opacity: '0', transform: 'translateY(24px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        rise_in:  'rise_in 700ms cubic-bezier(0.32, 0.72, 0, 1) both',
        fade_in:  'fade_in 450ms cubic-bezier(0.32, 0.72, 0, 1) both',
        sheet_up: 'sheet_up 450ms cubic-bezier(0.32, 0.72, 0, 1) both',
      },
    },
  },
  plugins: [],
}
