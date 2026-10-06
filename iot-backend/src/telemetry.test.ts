import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTelemetry } from './telemetry.js';

test('parses supported sensor readings', () => {
  assert.deepEqual(
    parseTelemetry('{"temperature":22.5,"humidity":48,"gas":120,"presence":true}'),
    { temperature: 22.5, humidity: 48, gas: 120, presence: true },
  );
});

test('rejects malformed or invalid readings', () => {
  assert.equal(parseTelemetry('{invalid'), null);
  assert.equal(parseTelemetry('{"temperature":"warm"}'), null);
  assert.equal(parseTelemetry('{"unrecognized":12}'), null);
});