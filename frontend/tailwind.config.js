/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [ './index.html', './src/**/*.{js,jsx,ts,tsx}' ],
  theme: {
    extend: {
      colors: {
        surface: '#0d0f11',
        border: '#181c1f'
      }
    }
  },
  safelist: [
    // toast color text classes we construct dynamically
    'text-blue-400','text-green-400','text-red-400','text-yellow-400','text-orange-400','text-sky-400'
  ],
  plugins: []
};
