import { useEffect, useState } from 'react';

export const ROUTES = ['metrics', 'camera', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

function readRoute(): Route {
  const route = window.location.hash.replace('#/', '');
  return ROUTES.includes(route as Route) ? (route as Route) : 'metrics';
}

// Hash-based navigation: works behind any static server without rewrites.
export function useRoute() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
