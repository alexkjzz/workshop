import type { Theme, ThemeStore } from '../application/ports';

// Also read by public/theme-init.js before the first paint.
const STORAGE_KEY = 'sentinel-theme';

export class LocalThemeStore implements ThemeStore {
  load(): Theme | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch {
      return null;
    }
  }

  save(theme: Theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable (private mode); the choice applies to this visit.
    }
  }
}
