/** @type {import('tailwindcss').Config} */
// IA palette is now driven by CSS custom properties in src/index.css.
// Flip <html data-theme="dark"> and every utility below restyles instantly.
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ia: {
          page:         'var(--ia-page)',
          card:         'var(--ia-card)',
          'card-hover': 'var(--ia-card-hover)',
          elevated:     'var(--ia-elevated)',

          navy:         'var(--ia-navy)',
          'navy-700':   'var(--ia-navy-700)',
          'navy-500':   'var(--ia-navy-500)',
          ink:          'var(--ia-ink)',
          muted:        'var(--ia-muted)',

          teal:         'var(--ia-teal)',
          'teal-700':   'var(--ia-teal-700)',
          'teal-light': 'var(--ia-teal-light)',
          orange:       'var(--ia-orange)',
          'orange-soft':'var(--ia-orange-soft)',

          // back-compat aliases for existing code
          cream:        'var(--ia-page)',
          'cream-dark': 'var(--ia-elevated)',

          border:       'var(--ia-border)',
          danger:       'var(--ia-danger)',
          warning:      'var(--ia-warning)',
          success:      'var(--ia-success)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'ia-card':     'var(--ia-shadow-card)',
        'ia-elevated': 'var(--ia-shadow-elevated)',
      },
    },
  },
  plugins: [],
};
