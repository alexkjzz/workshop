import { useEffect, useState } from 'react';
import type { Theme } from '../../application/ports';
import { useServices } from '../services-context';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

// Follows the system until the user picks a theme; the choice is then remembered.
export function useTheme() {
  const { themeStore } = useServices();
  const [chosen, setChosen] = useState<Theme | null>(() => themeStore.load());
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);

  useEffect(() => {
    const query = darkQuery();
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = chosen ?? (systemDark ? 'dark' : 'light');

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    themeStore.save(next);
    setChosen(next);
  };

  return { theme, toggleTheme };
}
