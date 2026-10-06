export interface Telemetry {
  temperature?: number;
  humidity?: number;
  gas?: number;
  presence?: boolean;
}

export interface DeviceStatus {
  mqttConnected: boolean;
  lastMessageAt: string | null;
  telemetry: Telemetry | null;
}

export function parseTelemetry(message: string): Telemetry | null {
  let value: unknown;

  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  const telemetry: Telemetry = {};
  const numericFields = ['temperature', 'humidity', 'gas'] as const;

  for (const field of numericFields) {
    if (field in input) {
      const reading = input[field];
      if (typeof reading !== 'number' || !Number.isFinite(reading)) {
        return null;
      }
      telemetry[field] = reading;
    }
  }

  if ('presence' in input) {
    if (typeof input.presence !== 'boolean') {
      return null;
    }
    telemetry.presence = input.presence;
  }

  return Object.keys(telemetry).length > 0 ? telemetry : null;
}