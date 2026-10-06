export interface Telemetry {
  temperature?: number;
  humidity?: number;
  gas?: number;
  presence?: boolean;
}

// A measurement as sent by the box. `measuredAt` is set when its clock is synchronized.
export interface TelemetryMeasurement {
  telemetry: Telemetry;
  measuredAt?: Date;
}

export interface Reading extends Telemetry {
  id: number;
  recordedAt: Date;
}

export interface DeviceStatus {
  mqttConnected: boolean;
  lastMessageAt: Date | null;
  telemetry: Telemetry | null;
}

export const DEVICE_COMMANDS = ['ON', 'OFF'] as const;
export type DeviceCommand = (typeof DEVICE_COMMANDS)[number];

export function isDeviceCommand(value: unknown): value is DeviceCommand {
  return DEVICE_COMMANDS.includes(value as DeviceCommand);
}

// Box clocks may drift; a timestamp further in the future is not trusted.
export const MAX_CLOCK_SKEW_MS = 60_000;

/**
 * Time at which a measurement is recorded. Readings buffered by the box while
 * offline keep their measurement time, as long as it is plausible: not in the
 * future and not older than the retention period.
 */
export function resolveRecordedAt(measuredAt: Date | undefined, now: Date, retentionMs: number): Date {
  if (!measuredAt) return now;
  const age = now.getTime() - measuredAt.getTime();
  return age >= -MAX_CLOCK_SKEW_MS && age <= retentionMs ? measuredAt : now;
}
