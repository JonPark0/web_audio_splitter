/** @type {import('tailwindcss').Config} */
// Monochrome system borrowed from Palnarium (Figma "Page Designs" + its
// client/static/styles.css): one family (Exo 2), one weight (300, hover 400),
// eight type sizes, an 8px spacing unit, and no chroma at all.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#141414',
        muted: '#8c8c8c',
        paper: '#ffffff',
        line: '#e7e7e4',
        hover: '#f4f4f2',
      },
      fontFamily: {
        sans: ['"Exo 2"', 'Pretendard', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        brand: ['Anta', '"Exo 2"', 'system-ui', 'sans-serif'],
      },
      // Figma Typography/* tokens
      fontSize: {
        caption: '0.8125rem', // 13
        p: '1rem', // 16
        h4: '1.0625rem', // 17
        h3: '1.375rem', // 22
        h2: '1.75rem', // 28
        h1: '2.375rem', // 38
        title: '3.5rem', // 56
        'title-sm': '2.5rem', // 40, title on <= 768px
      },
      fontWeight: {
        light: '300',
        normal: '400',
      },
      lineHeight: {
        tight: '1.2',
        body: '1.55',
      },
      maxWidth: {
        content: '1200px',
        wide: '1600px',
      },
      spacing: {
        edge: 'clamp(20px, 6vw, 40px)',
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
  plugins: [],
}
