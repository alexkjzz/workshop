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
  assert.equal(parseTelemetryMessage('{"presence":2}'), null);
  assert.equal(parseTelemetryMessage('{"gas":120,"timestamp":"invalid"}'), null);
});

test('normalizes numeric PIR values, ISO timestamps and explicit simulation source', () => {
  assert.deepEqual(parseTelemetryMessage('{"presence":1,"timestamp":"2026-10-06T10:00:00Z","source":"simulation"}'), {
    telemetry: { presence: true }, measuredAt: receivedAt, source: 'simulation',
  });
  assert.deepEqual(parseTelemetryMessage('{"presence":0}'), { telemetry: { presence: false } });
});

test('parses real serial bridge telemetry and preserves explicit false device flags', () => {
  const telemetry = {
    temperature: 22.5, humidity: 48, gas: 630, presence: true,
    climateValid: true, gasReady: true, pirReady: true, gasAlert: true,
    alarmActive: true, ledRed: true, ledOrange: false, ledGreen: false,
  };
  assert.deepEqual(parseTelemetryMessage(JSON.stringify({
    ...telemetry, device: 'sentinel-x-01', source: 'live', ts: receivedAt.getTime() / 1000,
  })), { telemetry, source: 'live', measuredAt: receivedAt });
});

test('normalizes legacy snake case flags and allows status during sensor warmup', () => {
  assert.deepEqual(parseTelemetryMessage(JSON.stringify({
    climate_valid: false, gas_ready: false, pir_ready: false, gas_alert: false,
    alarm: false, led_red: false, led_orange: true, led_green: false,
  })), { telemetry: {
    climateValid: false, gasReady: false, pirReady: false, gasAlert: false,
    alarmActive: false, ledRed: false, ledOrange: true, ledGreen: false,
  } });
  assert.deepEqual(parseTelemetryMessage('{"alarm_active":true}'), { telemetry: { alarmActive: true } });
  assert.deepEqual(parseTelemetryMessage('{"alarmActive":false,"alarm":false}'), { telemetry: { alarmActive: false } });
});

test('rejects nonboolean and conflicting device flags instead of guessing hardware state', () => {
  for (const message of [
    '{"gas":120,"gasReady":1}', '{"led_green":"false"}',
    '{"alarmActive":false,"alarm":true}', '{"climate_valid":null}',
    '{"gasReady":true,"gas_ready":false}',
  ]) assert.equal(parseTelemetryMessage(message), null, message);
});

test('rejects epoch timestamps outside the valid Date range for telemetry and vision', () => {
  for (const ts of [1e308, -1e308, 8640000000001]) {
    assert.equal(parseTelemetryMessage(JSON.stringify({ gas: 120, ts })), null);
    assert.equal(parseVisionMessage(JSON.stringify({ faces: [], ts }), receivedAt), null);
  }
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

test('vision messages preserve simulation provenance so the demo cannot send real alerts', () => {
  const detection = { ts: receivedAt.getTime() / 1000, persons: 1,
    faces: [{ name: null, confidence: 0.64 }] };
  assert.deepEqual(parseVisionMessage(JSON.stringify({ ...detection, source: 'simulation' }), receivedAt), {
    detectedAt: receivedAt, persons: 1, faces: detection.faces, source: 'simulation',
  });
  assert.equal(parseVisionMessage(JSON.stringify({ ...detection, source: 'live' }), receivedAt)?.source, 'live');
});
