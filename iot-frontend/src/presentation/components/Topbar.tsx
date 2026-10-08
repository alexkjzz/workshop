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

const pages: { route: Route; label: string; icon: string }[] = [
  { route: 'metrics', label: 'Métriques', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { route: 'camera', label: 'Caméra', icon: 'M14 4l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4l2-3z' },
  { route: 'settings', label: 'Paramètres', icon: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6' },
];

export function Topbar({ route, userName, onSignOut }: TopbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="topbar-brand" href="#/metrics" aria-label="Sentinel-X, accueil">
          <span className="topbar-emblem">
            <svg {...iconProps} width={23} height={23}>
              <path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
              <path d="M8 12l3 3 5-6" />
            </svg>
          </span>
          <span>
            <span className="topbar-wordmark">SENTINEL<b>-X</b></span>
            <span className="topbar-tagline">Supervision connectée</span>
          </span>
        </a>
        {route && (
          <nav className="topbar-nav" aria-label="Pages">
            {pages.map((page) => (
              <a
                key={page.route}
                href={`#/${page.route}`}
                aria-current={route === page.route ? 'page' : undefined}
              >
                <svg {...iconProps}><path d={page.icon} />{page.route === 'camera' && <circle cx="12" cy="13" r="3" />}</svg>
                {page.label}
              </a>
            ))}
          </nav>
        )}
        <div className="topbar-actions">
          {userName && <span className="topbar-user">{userName}</span>}
          {onSignOut && (
            <button type="button" className="topbar-link" onClick={onSignOut} aria-label="Se déconnecter" title="Se déconnecter">
              <svg {...iconProps}><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10" /></svg>
              <span>Se déconnecter</span>
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
