/** @type {import('tailwindcss').Config} */
// IA palette: Navy #1A2744, Teal #0E7C7B, Light Teal #E0F0EF, Cream #F5F0EB, body #333333.
// All modules pull colors via Tailwind utilities like bg-ia-navy, text-ia-teal, etc.
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ia: {
          navy:       '#1A2744',
          'navy-700': '#243454',
          'navy-500': '#37466a',
          teal:       '#0E7C7B',
          'teal-700': '#0a5e5d',
          'teal-light': '#E0F0EF',
          cream:      '#F5F0EB',
          'cream-dark': '#ECE5DA',
          ink:        '#333333',
          muted:      '#6b7280',
          'border':   '#E5E1DA',
          danger:     '#b91c1c',
          warning:    '#b45309',
          success:    '#0f766e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'ia-card': '0 1px 2px rgba(26, 39, 68, 0.06), 0 4px 12px rgba(26, 39, 68, 0.04)',
      },
    },
  },
  plugins: [],
};
