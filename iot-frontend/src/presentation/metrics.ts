import type { MetricKey } from '../domain/telemetry';

export interface MetricView {
  key: MetricKey;
  label: string;
  format: (value: number) => string;
  // Discrete states: stepped chart with named ticks.
  steps?: { value: number; label: string }[];
}

export const metricViews: MetricView[] = [
  { key: 'temperature', label: 'Température', format: (value) => `${value.toFixed(1)} °C` },
  { key: 'humidity', label: 'Humidité', format: (value) => `${value.toFixed(0)} %` },
  { key: 'gas', label: 'Gaz', format: (value) => value.toFixed(0) },
  {
    key: 'presence',
    label: 'Présence',
    format: (value) => (value ? 'Oui' : 'Non'),
    steps: [
      { value: 0, label: 'Non' },
      { value: 1, label: 'Oui' },
    ],
  },
];
