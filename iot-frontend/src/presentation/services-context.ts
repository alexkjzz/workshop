import { createContext, useContext } from 'react';
import type { Services } from '../application/ports';

// Concrete services are provided by the composition root (main.tsx).
export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesContext is missing.');
  return services;
}
