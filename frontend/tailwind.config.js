/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark mode backgrounds
        'bg-primary': '#0d1117',
        'bg-secondary': '#161b22',
        'bg-tertiary': '#21262d',

        // Borders
        'border-primary': '#30363d',
        'border-default': '#30363d',
        'border-muted': '#21262d',

        // Text
        'text-primary': '#e6edf3',
        'text-secondary': '#8b949e',
        'text-tertiary': '#484f58',
        'text-muted': '#6e7681',

        // Status colors
        'status-green': '#3fb950',
        'status-amber': '#d29922',
        'status-red': '#f85149',
        'status-blue': '#58a6ff',

        // Accent colors
        'accent-primary': '#39d5ff',
        'accent-cyan': '#39d5ff',
        'accent-blue': '#58a6ff',
        'accent-teal': '#2dd4bf',
        'accent-purple': '#a855f7',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flow': 'flow 2s linear infinite',
      },
      keyframes: {
        flow: {
          '0%': { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
      },
    },
  },
  plugins: [],
}
