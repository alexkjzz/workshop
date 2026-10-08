export interface Telemetry {
  temperature?: number;
  humidity?: number;
  gas?: number;
  presence?: boolean;
  climateValid?: boolean;
  gasReady?: boolean;
  pirReady?: boolean;
  gasAlert?: boolean;
  alarmActive?: boolean;
  ledRed?: boolean;
  ledOrange?: boolean;
  ledGreen?: boolean;
}

export type MetricKey = 'temperature' | 'humidity' | 'gas' | 'presence';

export interface DeviceStatus {
  mqttConnected: boolean;
  lastMessageAt: string | null;
  telemetry: Telemetry | null;
}

export type DeviceCommand = 'ON' | 'OFF';

export interface Reading extends Telemetry {
  id: number;
  recordedAt: string;
}

// Readings kept for the charts and tables (about 5 minutes at one reading every 2 s).
export const HISTORY_SIZE = 150;

// Readings replayed by the box after a disconnection arrive late but keep their time.
export function mergeReadings(current: Reading[], incoming: Reading[]): Reading[] {
  const byId = new Map(current.map((reading) => [reading.id, reading]));
  for (const reading of incoming) byId.set(reading.id, reading);
  return [...byId.values()]
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id - b.id)
    .slice(-HISTORY_SIZE);
}

// Numeric value of a metric (presence: 0 or 1), undefined when not measured.
export function metricValue(telemetry: Telemetry | null | undefined, key: MetricKey): number | undefined {
  if ((key === 'temperature' || key === 'humidity') && telemetry?.climateValid === false) return undefined;
  if (key === 'gas' && telemetry?.gasReady === false) return undefined;
  if (key === 'presence' && telemetry?.pirReady === false) return undefined;
  const value = telemetry?.[key];
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? Number(value) : Number.isFinite(value) ? value : undefined;
}

export interface TimedValue {
  time: number;
  value: number;
}

// Time series of one metric, oldest first.
export function metricSeries(readings: Reading[], key: MetricKey): TimedValue[] {
  const series: TimedValue[] = [];
  for (const reading of readings) {
    const value = metricValue(reading, key);
    if (value !== undefined) series.push({ time: Date.parse(reading.recordedAt), value });
  }
  return series;
}
