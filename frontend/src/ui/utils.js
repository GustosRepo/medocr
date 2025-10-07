// Utility mappings and helpers

export function getStatusBadgeColor(status) {
  switch (status) {
    case 'done': return 'green';
    case 'error': return 'red';
    case 'rate-limit': return 'orange';
    case 'net-error': return 'yellow';
    case 'processing':
    case 'submitted': return 'blue';
    case 'queued': return 'gray';
    case 'uploading': return 'gray';
    default: return 'gray';
  }
}

export function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

export const THEME_STORAGE_KEY = 'pref-theme';

export function applyThemeClass(theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
  }
}