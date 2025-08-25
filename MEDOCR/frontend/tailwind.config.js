/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#232946',
        secondary: '#eebbc3',
        accent: '#b8c1ec',
        surface: '#f8f8f8',
        text: '#333',
        textLight: '#666'
      }
    },
  },
  plugins: [],
}
