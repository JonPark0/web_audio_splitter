/** @type {import('tailwindcss').Config} */
// Monochrome system borrowed from Palnarium (JonPark0/palnarium
// client/static/styles.css + its design-system tokens): one family (Exo 2,
// Pretendard for Hangul), one weight (300, hover/current 400), seven type
// sizes plus the wordmark, an 8px spacing unit, square corners, no shadows
// and no chroma at all.
//
// Colour, type, weight, line-height, radius and shadow scales are set on
// `theme` (not `extend`) on purpose: Tailwind's default palette, font-bold,
// text-lg, rounded-md, shadow-md ... simply don't exist here, so they can't
// creep back in.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      ink: '#141414', // all text, icons, underlines, focus rings
      muted: '#8c8c8c', // secondary text only (3.4:1 - never for text a reader must act on)
      paper: '#ffffff', // the only surface
      line: '#e7e7e4', // hairline dividers (decorative, 1.2:1)
      wash: '#f4f4f2', // the one hover fill
      hover: '#f4f4f2', // alias of `wash` (older name, still used)
    },
    fontFamily: {
      sans: ['"Exo 2"', 'Pretendard', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      brand: ['Anta', '"Exo 2"', 'Pretendard', 'system-ui', 'sans-serif'],
    },
    // Figma Typography/* tokens. Display sizes carry lh-tight (1.2), text
    // sizes lh-body (1.55); an explicit leading-* still wins.
    fontSize: {
      caption: ['0.8125rem', { lineHeight: '1.55' }], // 13
      p: ['1rem', { lineHeight: '1.55' }], // 16
      h4: ['1.0625rem', { lineHeight: '1.55' }], // 17
      h3: ['1.375rem', { lineHeight: '1.2' }], // 22
      h2: ['1.75rem', { lineHeight: '1.2' }], // 28
      h1: ['2.375rem', { lineHeight: '1.2' }], // 38; 32 at <= 768px
      title: ['3.5rem', { lineHeight: '1.2' }], // 56
      'title-sm': ['2.5rem', { lineHeight: '1.2' }], // 40, title at <= 768px
      logo: ['3.125rem', { lineHeight: '1' }], // 50, wordmark
      'logo-sub': ['1.25rem', { lineHeight: '1.55' }], // 20, tagline
    },
    // One weight. `normal` (400) is for hover/current states only.
    fontWeight: {
      light: '300',
      normal: '400',
    },
    lineHeight: {
      none: '1',
      tight: '1.2',
      body: '1.55',
    },
    letterSpacing: {
      normal: '0',
      logo: '-0.01em', // Anta wordmark
    },
    // Square everywhere; the only curve is a full circle (dots, slider thumb).
    borderRadius: {
      none: '0',
      full: '9999px',
    },
    boxShadow: {
      none: 'none',
    },
    extend: {
      // Palnarium's desktop layout starts at 769px (mobile is <= 768px).
      screens: {
        md: '769px',
      },
      maxWidth: {
        content: '1200px', // .wrap / page chrome
        column: '1000px', // post body
        frame: '720px', // post header, single figures
        measure: '560px', // body-copy column
        wide: '1600px', // app-only: mixer / library / arrange
      },
      spacing: {
        edge: 'clamp(20px, 6vw, 40px)',
      },
      // Palnarium's opacity steps: .1 hero wash, .25 disabled, .55 row hover,
      // .8 pressed.
      opacity: {
        55: '0.55',
      },
      // Palnarium's durations: 90 press, 140 hover, 200 dots, 440 page fade.
      transitionDuration: {
        90: '90ms',
        140: '140ms',
        440: '440ms',
      },
      keyframes: {
        slide: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        slide: 'slide 1.6s ease-in-out infinite',
      },
    },
  },
  // Rings are box-shadows whose default colour is Tailwind's blue-500 (it
  // falls back to it even with the palette replaced). Focus is a 2px ink
  // outline here, so the ring utilities are switched off.
  corePlugins: {
    ringWidth: false,
    ringColor: false,
    ringOpacity: false,
    ringOffsetWidth: false,
    ringOffsetColor: false,
  },
  plugins: [],
}
