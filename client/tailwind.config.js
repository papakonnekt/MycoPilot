/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Lab paper — warm off-white canvas
        paper: '#F5F4F0',
        // Ink — sharp dark text
        ink: '#0A0A0A',
        // Mossy deep forest — primary action accent
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
        // Subtle graphite for secondary text
        graphite: {
          400: '#6B6B6B',
          500: '#4A4A4A',
          600: '#2A2A2A',
        },
        // Soft alert tones (subdued, lab-appropriate)
        amber_lab: '#B97A1F',
        rose_lab: '#A3362C',
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', '"PP Editorial New"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        squircle: '1.75rem',
        squircle_lg: '2.25rem',
      },
      boxShadow: {
        // Diffused ambient — never harsh
        ambient: '0 1px 1px rgba(10,10,10,0.02), 0 8px 24px -12px rgba(10,10,10,0.08), 0 24px 60px -24px rgba(10,10,10,0.10)',
        ambient_lg: '0 1px 1px rgba(10,10,10,0.03), 0 16px 48px -16px rgba(10,10,10,0.10), 0 48px 120px -32px rgba(10,10,10,0.12)',
        // Inner highlight for double-bezel cores
        bezel_inner: 'inset 0 1px 1px rgba(255,255,255,0.60), inset 0 -1px 0 rgba(10,10,10,0.02)',
        bezel_inner_dark: 'inset 0 1px 1px rgba(255,255,255,0.04)',
      },
      transitionTimingFunction: {
        fluid: 'cubic-bezier(0.32, 0.72, 0, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '450': '450ms',
        '550': '550ms',
        '700': '700ms',
      },
      letterSpacing: {
        eyebrow: '0.2em',
        wide_lab: '0.08em',
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
        rise_in: 'rise_in 700ms cubic-bezier(0.32, 0.72, 0, 1) both',
        fade_in: 'fade_in 450ms cubic-bezier(0.32, 0.72, 0, 1) both',
        sheet_up: 'sheet_up 450ms cubic-bezier(0.32, 0.72, 0, 1) both',
      },
    },
  },
  plugins: [],
}
