import assert from 'node:assert/strict';
import test from 'node:test';
import type { Reading, Telemetry } from '../../domain/telemetry.js';
import { DeviceState } from '../device-state.js';
import type { LiveEvent, ReadingRepository } from '../ports.js';
import { RecordTelemetry } from './record-telemetry.js';

class InMemoryReadings implements ReadingRepository {
  readings: Reading[] = [];
  save(telemetry: Telemetry, recordedAt: Date, source: 'live' | 'simulation' = 'live'): Reading {
    const reading = { id: this.readings.length + 1, recordedAt, ...telemetry, source };
    this.readings.push(reading);
    return reading;
  }
  findRecent(limit: number) {
    return [...this.readings].sort((a, b) => +b.recordedAt - +a.recordedAt).slice(0, limit);
  }
  deleteOlderThan() {
    return 0;
  }
}

function setup() {
  const readings = new InMemoryReadings();
  const state = new DeviceState();
  const published: LiveEvent[] = [];
  const events = { publish: (event: LiveEvent) => published.push(event), subscribe: () => () => {} };
  const clock = { now: () => new Date('2026-10-06T10:00:00Z') };
  const recordTelemetry = new RecordTelemetry(readings, state, events, clock, 7 * 24 * 3600 * 1000);
  return { readings, state, published, recordTelemetry };
}

test('stores, exposes and broadcasts a reading', () => {
  const { readings, state, published, recordTelemetry } = setup();
  const reading = recordTelemetry.execute({ telemetry: { gas: 120 } });

  assert.equal(readings.readings.length, 1);
  assert.deepEqual(state.latest(), { telemetry: { gas: 120 }, lastMessageAt: reading.recordedAt });
  assert.deepEqual(published, [{ type: 'reading', reading }]);
});

test('a replayed reading is stored at its time without replacing the latest state', () => {
  const { state, recordTelemetry } = setup();
  recordTelemetry.execute({ telemetry: { gas: 130 } });
  const replayed = recordTelemetry.execute({
    telemetry: { gas: 90 },
    measuredAt: new Date('2026-10-06T09:57:00Z'),
  });

  assert.equal(replayed.recordedAt.toISOString(), '2026-10-06T09:57:00.000Z');
  assert.deepEqual(state.latest().telemetry, { gas: 130 });
});

test('hardware flags reach device status, history and live reading events unchanged', () => {
  const { readings, state, published, recordTelemetry } = setup();
  const telemetry = {
    gas: 625, presence: true, climateValid: false, gasReady: true, pirReady: true,
    gasAlert: true, alarmActive: true, ledRed: true, ledOrange: false, ledGreen: false,
  };
  const reading = recordTelemetry.execute({ telemetry, source: 'live' });
  assert.deepEqual(state.latest().telemetry, telemetry);
  assert.deepEqual(readings.findRecent(1), [reading]);
  assert.deepEqual(published, [{ type: 'reading', reading, source: 'live' }]);
});

test('simulation remains stored and streamed without replacing the physical status', () => {
  const { readings, state, published, recordTelemetry } = setup();
  const physical = recordTelemetry.execute({ telemetry: { gas: 38, gasReady: true,
    alarmActive: true, ledRed: true }, source: 'live' });
  const simulated = recordTelemetry.execute({ telemetry: { gas: 700, alarmActive: false,
    ledRed: false }, source: 'simulation' });
  assert.equal(simulated.source, 'simulation');
  assert.equal(readings.readings.length, 2);
  assert.deepEqual(readings.findRecent(2), [physical, simulated]);
  assert.deepEqual(state.latest(), { telemetry: { gas: 38, gasReady: true, alarmActive: true,
    ledRed: true }, lastMessageAt: physical.recordedAt });
  assert.deepEqual(published.at(-1), { type: 'reading', reading: simulated, source: 'simulation' });
});
