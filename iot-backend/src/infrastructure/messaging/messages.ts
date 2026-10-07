// MQTT payloads -> domain objects. Anything malformed is rejected as a whole.
import type { DeviceFlags, TelemetryMeasurement, Telemetry } from '../../domain/telemetry.js';
import type { Face, VisionDetection } from '../../domain/vision.js';

const MAX_FACES = 20;
const FLAG_ALIASES: Record<keyof DeviceFlags, readonly string[]> = {
  climateValid: ['climateValid', 'climate_valid'],
  gasReady: ['gasReady', 'gas_ready'],
  pirReady: ['pirReady', 'pir_ready'],
  gasAlert: ['gasAlert', 'gas_alert'],
  alarmActive: ['alarmActive', 'alarm_active', 'alarm'],
  ledRed: ['ledRed', 'led_red'],
  ledOrange: ['ledOrange', 'led_orange'],
  ledGreen: ['ledGreen', 'led_green'],
};

function parseObject(message: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Optional `ts` field: epoch seconds. undefined if absent, null if invalid.
function parseTimestamp(input: Record<string, unknown>): Date | undefined | null {
  if ('ts' in input) {
    if (typeof input.ts !== 'number' || !Number.isFinite(input.ts)) return null;
    const date = new Date(input.ts * 1000);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (!('timestamp' in input)) return undefined;
  if (typeof input.timestamp !== 'string') return null;
  const date = new Date(input.timestamp);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Box telemetry on MQTT_TELEMETRY_TOPIC:
 * {"temperature":22.5,"humidity":48,"gas":120,"presence":true,"ts":1791280000}
 * Sensor fields and boolean device flags are optional. Other fields (device, rssi) are ignored.
 */
export function parseTelemetryMessage(message: string): TelemetryMeasurement | null {
  const input = parseObject(message);
  if (!input) return null;

  const telemetry: Telemetry = {};
  for (const field of ['temperature', 'humidity', 'gas'] as const) {
    if (field in input) {
      const reading = input[field];
      if (typeof reading !== 'number' || !Number.isFinite(reading)) return null;
      telemetry[field] = reading;
    }
  }
  if ('presence' in input) {
    if (typeof input.presence !== 'boolean' && input.presence !== 0 && input.presence !== 1) return null;
    telemetry.presence = Boolean(input.presence);
  }
  for (const field of Object.keys(FLAG_ALIASES) as Array<keyof DeviceFlags>) {
    for (const alias of FLAG_ALIASES[field]) {
      if (!(alias in input)) continue;
      const value = input[alias];
      // Reject conflicting aliases rather than inventing a device state.
      if (typeof value !== 'boolean' || (telemetry[field] !== undefined && telemetry[field] !== value)) return null;
      telemetry[field] = value;
    }
  }
  if (Object.keys(telemetry).length === 0) return null;

  const measuredAt = parseTimestamp(input);
  if (measuredAt === null) return null;
  return {
    telemetry,
    ...(measuredAt ? { measuredAt } : {}),
    ...(input.source === 'live' || input.source === 'simulation' ? { source: input.source } : {}),
  };
}

function parseFace(value: unknown): Face | null {
  if (typeof value !== 'object' || value === null) return null;
  const face = value as Record<string, unknown>;
  const name = face.name ?? null;
  if (name !== null && (typeof name !== 'string' || name.length > 64)) return null;
  if (typeof face.confidence !== 'number' || face.confidence < 0 || face.confidence > 1) return null;
  return { name, confidence: face.confidence };
}

/**
 * Contract with the AI team's vision script, on MQTT_VISION_TOPIC:
 * {"ts":1791280000,"persons":1,"faces":[{"name":"Alice","confidence":0.92}]}
 * `name` is null for an unknown face; `ts` and `persons` are optional.
 */
export function parseVisionMessage(message: string, receivedAt: Date): VisionDetection | null {
  const input = parseObject(message);
  if (!input || !Array.isArray(input.faces) || input.faces.length > MAX_FACES) return null;

  const faces = input.faces.map(parseFace);
  if (faces.some((face) => face === null)) return null;

  const persons = input.persons ?? faces.length;
  if (typeof persons !== 'number' || !Number.isInteger(persons) || persons < 0) return null;

  const detectedAt = parseTimestamp(input);
  if (detectedAt === null) return null;
  return { detectedAt: detectedAt ?? receivedAt, persons, faces: faces as Face[] };
}
