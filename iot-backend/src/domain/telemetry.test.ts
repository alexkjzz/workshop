import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeviceCommand, resolveRecordedAt } from './telemetry.js';

const now = new Date('2026-10-06T10:00:00Z');
const retention = 7 * 24 * 60 * 60 * 1000;

test('keeps a plausible measurement time', () => {
  const measuredAt = new Date('2026-10-06T09:57:00Z');
  assert.equal(resolveRecordedAt(measuredAt, now, retention), measuredAt);
  assert.equal(resolveRecordedAt(undefined, now, retention), now);
});

test('falls back to the reception time for implausible timestamps', () => {
  assert.equal(resolveRecordedAt(new Date('2026-10-07T10:00:00Z'), now, retention), now);
  assert.equal(resolveRecordedAt(new Date('2026-09-01T10:00:00Z'), now, retention), now);
});

test('recognizes device commands', () => {
  assert.equal(isDeviceCommand('ON'), true);
  assert.equal(isDeviceCommand('on'), false);
  assert.equal(isDeviceCommand(undefined), false);
});
