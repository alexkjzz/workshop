import assert from 'node:assert/strict';
import test from 'node:test';
import { AlertDetector } from './alert-detector.js';
import { aiPrediction } from '../testing/ai-fixture.js';

const now = new Date('2026-10-06T10:00:00Z');
const reading = (presence: boolean, recordedAt = now) => ({ type: 'reading' as const, reading: { id: 1, recordedAt, presence } });

test('raises an intrusion when presence starts, once', () => {
  const detector = new AlertDetector();
  assert.equal(detector.fromEvent(reading(false), now), null);
  assert.deepEqual(detector.fromEvent(reading(true), now), { type: 'intrusion', occurredAt: now });
  assert.equal(detector.fromEvent(reading(true), now), null);
});

test('ignores readings replayed after an outage', () => {
  const detector = new AlertDetector();
  assert.equal(detector.fromEvent(reading(true, new Date('2026-10-06T09:55:00Z')), now), null);
});

test('ignores PIR activity during warmup and alerts only once the sensor is ready', () => {
  const detector = new AlertDetector();
  const presence = reading(true);
  assert.equal(detector.fromEvent({ ...presence, reading: { ...presence.reading, pirReady: false } }, now), null);
  assert.equal(detector.fromEvent({ ...presence, reading: { ...presence.reading, pirReady: true } }, now)?.type, 'intrusion');
  assert.equal(detector.fromEvent({ ...presence, reading: { ...presence.reading, pirReady: true } }, now), null);
});

test('raises an alert for an unknown face only', () => {
  const detector = new AlertDetector();
  const vision = (name: string | null) => ({
    type: 'vision' as const,
    detection: { detectedAt: now, persons: 1, faces: [{ name, confidence: 0.8 }] },
  });
  assert.equal(detector.fromEvent(vision('Alice'), now), null);
  assert.equal(detector.fromEvent(vision(null), now)?.type, 'unknown-face');
});

test('raises an offline alert once per silence', () => {
  const detector = new AlertDetector();
  const last = new Date('2026-10-06T09:59:00Z');
  assert.equal(detector.fromHeartbeat(last, now)?.type, 'device-offline');
  assert.equal(detector.fromHeartbeat(last, now), null);
  assert.equal(detector.fromHeartbeat(now, now), null);
  assert.equal(detector.fromHeartbeat(now, new Date('2026-10-06T10:01:00Z'))?.type, 'device-offline');
});

test('AI live events preserve legacy face and device notification handling', () => {
  const detector = new AlertDetector();
  assert.equal(detector.fromEvent({ type: 'ai', prediction: { ...aiPrediction(), id: 1 } }, now), null);
  assert.equal(detector.fromEvent({ type: 'ai-status', status: {
    online: false, model_loaded: false, vision: null, last_success_at: null,
    last_error: null, queue_depth: 0, dropped_samples: 0,
  } }, now), null);
});
