import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTelemetryMessage, parseVisionMessage } from './messages.js';

const receivedAt = new Date('2026-10-06T10:00:00.000Z');

test('parses supported sensor readings', () => {
  assert.deepEqual(
    parseTelemetryMessage('{"temperature":22.5,"humidity":48,"gas":120,"presence":true,"rssi":-61}'),
    { telemetry: { temperature: 22.5, humidity: 48, gas: 120, presence: true } },
  );
  assert.deepEqual(parseTelemetryMessage('{"gas":120,"ts":1791280000}'), {
    telemetry: { gas: 120 },
    measuredAt: new Date(1791280000 * 1000),
  });
});

test('rejects malformed or invalid readings', () => {
  assert.equal(parseTelemetryMessage('{invalid'), null);
  assert.equal(parseTelemetryMessage('{"temperature":"warm"}'), null);
  assert.equal(parseTelemetryMessage('{"unrecognized":12}'), null);
  assert.equal(parseTelemetryMessage('{"gas":120,"ts":"now"}'), null);
  assert.equal(parseTelemetryMessage('{"ts":1791280000}'), null);
});

test('parses vision detections', () => {
  assert.deepEqual(
    parseVisionMessage(
      '{"ts":1791280000,"persons":2,"faces":[{"name":"Alice","confidence":0.92},{"name":null,"confidence":0.4}]}',
      receivedAt,
    ),
    {
      detectedAt: new Date(1791280000 * 1000),
      persons: 2,
      faces: [
        { name: 'Alice', confidence: 0.92 },
        { name: null, confidence: 0.4 },
      ],
    },
  );
  assert.deepEqual(parseVisionMessage('{"faces":[]}', receivedAt), {
    detectedAt: receivedAt,
    persons: 0,
    faces: [],
  });
});

test('rejects malformed vision detections', () => {
  assert.equal(parseVisionMessage('{invalid', receivedAt), null);
  assert.equal(parseVisionMessage('{"faces":[{"name":"Alice","confidence":2}]}', receivedAt), null);
  assert.equal(parseVisionMessage('{"faces":[{"name":42,"confidence":0.5}]}', receivedAt), null);
  assert.equal(parseVisionMessage('{"persons":1}', receivedAt), null);
});
