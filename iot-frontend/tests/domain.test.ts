// Pure domain rules, run with Node's built-in test runner (npm test).
import assert from 'node:assert/strict';
import test from 'node:test';
import { HISTORY_SIZE, mergeReadings, metricSeries, metricValue, type Reading } from '../src/domain/telemetry.ts';
import { currentDetection, hasUnknownFace, mergeDetections, type VisionDetection } from '../src/domain/vision.ts';

const reading = (id: number, recordedAt: string, extra: Partial<Reading> = {}): Reading => ({ id, recordedAt, ...extra });

test('merges readings by time, without duplicates, within the history size', () => {
  const merged = mergeReadings(
    [reading(2, '2026-10-06T10:00:04.000Z')],
    [reading(3, '2026-10-06T10:00:02.000Z'), reading(2, '2026-10-06T10:00:04.000Z')],
  );
  assert.deepEqual(merged.map((r) => r.id), [3, 2]);

  const many = Array.from({ length: HISTORY_SIZE + 10 }, (_, i) => reading(i, new Date(i * 1000).toISOString()));
  assert.equal(mergeReadings([], many).length, HISTORY_SIZE);
});

test('extracts numeric metric values and series', () => {
  assert.equal(metricValue({ presence: true }, 'presence'), 1);
  assert.equal(metricValue({ gas: 120 }, 'temperature'), undefined);
  assert.deepEqual(
    metricSeries([reading(1, '2026-10-06T10:00:00.000Z', { gas: 120 }), reading(2, '2026-10-06T10:00:02.000Z')], 'gas'),
    [{ time: Date.parse('2026-10-06T10:00:00.000Z'), value: 120 }],
  );
});

test('a detection is current for a few seconds only', () => {
  const detection: VisionDetection = { detectedAt: '2026-10-06T10:00:00.000Z', persons: 1, faces: [{ name: null, confidence: 0.6 }] };
  const at = Date.parse(detection.detectedAt);
  assert.equal(currentDetection([detection], at + 2000), detection);
  assert.equal(currentDetection([detection], at + 6000), null);
  assert.equal(hasUnknownFace(detection), true);
  assert.equal(mergeDetections([detection], [detection]).length, 1);
});
