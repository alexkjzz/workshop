import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceState } from './device-state.js';

const now = new Date('2026-10-06T10:00:00Z');

test('simulation alone does not advertise a connected physical ESP', () => {
  const state = new DeviceState();
  state.applyReading({ id: 1, recordedAt: now, temperature: 24, presence: true,
    source: 'simulation', ledRed: true, alarmActive: true });
  assert.deepEqual(state.latest(), { telemetry: null, lastMessageAt: null });
});

test('simulation cannot overwrite physical telemetry, flags or heartbeat', () => {
  const state = new DeviceState();
  state.applyReading({ id: 1, recordedAt: now, source: 'live', temperature: 76.8,
    humidity: 6.9, gas: 38, presence: true, climateValid: true, alarmActive: true, ledRed: true });
  const physical = state.latest();
  state.applyReading({ id: 2, recordedAt: new Date(+now + 10_000), source: 'simulation',
    temperature: 22, presence: false, alarmActive: false, ledGreen: true });
  assert.deepEqual(state.latest(), physical);
  assert.equal(state.latest().telemetry?.temperature, 76.8);
  assert.equal(state.latest().telemetry?.humidity, 6.9);
  state.applyReading({ id: 3, recordedAt: new Date(+now + 1_000), source: 'live',
    temperature: 76.9, gas: 39, presence: false, ledRed: false });
  assert.equal(state.latest().telemetry?.temperature, 76.9);
  assert.equal(state.latest().telemetry?.ledRed, false);
});
