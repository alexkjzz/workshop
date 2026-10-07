import type { Route } from '../hooks/useRoute';
import { useTheme } from '../hooks/useTheme';
import './Topbar.css';

interface TopbarProps {
  route?: Route;
  userName?: string;
  onSignOut?: () => void;
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const pages: { route: Route; label: string }[] = [
  { route: 'metrics', label: 'Métriques' },
  { route: 'camera', label: 'Caméra' },
  { route: 'settings', label: 'Paramètres' },
];

export function Topbar({ route, userName, onSignOut }: TopbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="topbar-brand">SENTINEL-X</span>
        {route && (
          <nav className="topbar-nav" aria-label="Pages">
            {pages.map((page) => (
              <a
                key={page.route}
                href={`#/${page.route}`}
                aria-current={route === page.route ? 'page' : undefined}
              >
                {page.label}
              </a>
            ))}
          </nav>
        )}
        <div className="topbar-actions">
          {userName && <span className="topbar-user">{userName}</span>}
          {onSignOut && (
            <button type="button" className="topbar-link" onClick={onSignOut}>
              Se déconnecter
            </button>
          )}
          <button
            type="button"
            className="topbar-theme"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          >
            {theme === 'dark' ? (
              <svg {...iconProps}>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg {...iconProps}>
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
