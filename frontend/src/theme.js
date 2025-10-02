// Minimal Mantine theme (Option 1 reset)
export const theme = {
  primaryColor: 'brand',
  colors: {
    brand: ['#e7f2ff','#c6e2ff','#a2d1ff','#7dc0ff','#57afff','#349fff','#1586e6','#0a6ab8','#054c83','#053960']
  },
  components: {
    Paper: {
      styles: () => ({
        root: {
          backgroundColor: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4), 0 4px 18px -4px rgba(0,0,0,0.45)'
        }
      })
    },
    Text: {
      styles: () => ({
        root: {
          color: 'var(--text-primary)'
        }
      })
    }
  },
  globalStyles: () => ({
    ':root[data-mantine-color-scheme="dark"]': {
      /* Dark scheme */
      '--surface-0': '#020406ff',
      '--surface-1': '#16222d',
      '--surface-2': '#1d2b38',
      '--surface-3': '#243645',
      '--surface-border': 'rgba(255,255,255,0.10)',
      '--surface-border-soft': 'rgba(255,255,255,0.06)',
      '--surface-code': '#1d2b38',
      '--text-primary': '#e3edf5',
      '--text-muted': '#9aa8b5',
      '--brand-accent': '#349fff',
      '--brand-soft': 'rgba(52,159,255,0.14)'
    },
    ':root[data-mantine-color-scheme="light"]': {
      /* Light scheme (dialed down brightness; softer low-glare neutrals) */
      '--surface-0': '#313233ff',      /* app background */
      '--surface-1': '#454647ff',      /* base cards (not pure white) */
      '--surface-2': '#505052ff',      /* elevated cards */
      '--surface-3': '#4c4c4dff',
      '--surface-border': 'rgba(0,0,0,0.10)',
      '--surface-border-soft': 'rgba(0,0,0,0.06)',
      '--surface-code': '#6d7073ff',
      '--text-primary': '#1e262f',
      '--text-muted': '#667380',
      '--brand-accent': '#0a6ab8',
      '--brand-soft': 'rgba(10,106,184,0.14)'
    },
    body: {
      margin: 0,
      background: 'linear-gradient(140deg, var(--surface-0) 0%, var(--surface-1) 55%, var(--surface-2) 100%)',
      color: 'var(--text-primary)',
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    },
    '.section-heading': {
      textTransform: 'uppercase',
      fontSize: '11px',
      letterSpacing: '0.55px',
      fontWeight: 600,
      marginBottom: 8,
      color: 'var(--text-muted)'
    }
  })
};

export default theme;
