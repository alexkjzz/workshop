// Applies the saved theme before the first paint (external file: allowed by the CSP).
// Same storage key as src/infrastructure/local-theme-store.ts.
try {
  const theme = localStorage.getItem('sentinel-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage unavailable: the system theme applies.
}
