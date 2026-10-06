// MQTT payloads -> domain objects. Anything malformed is rejected as a whole.
import type { TelemetryMeasurement, Telemetry } from '../../domain/telemetry.js';
import type { Face, VisionDetection } from '../../domain/vision.js';

const MAX_FACES = 20;

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
  if (!('ts' in input)) return undefined;
  return typeof input.ts === 'number' && Number.isFinite(input.ts) ? new Date(input.ts * 1000) : null;
}

/**
 * Box telemetry on MQTT_TELEMETRY_TOPIC:
 * {"temperature":22.5,"humidity":48,"gas":120,"presence":true,"ts":1791280000}
 * All fields are optional; other fields (device, rssi) are ignored.
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
    if (typeof input.presence !== 'boolean') return null;
    telemetry.presence = input.presence;
  }
  if (Object.keys(telemetry).length === 0) return null;

  const measuredAt = parseTimestamp(input);
  if (measuredAt === null) return null;
  return measuredAt ? { telemetry, measuredAt } : { telemetry };
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
