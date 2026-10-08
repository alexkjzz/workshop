import assert from 'node:assert/strict';
import test from 'node:test';
import { ALERT_CLOCK_SKEW_MS, ALERT_MAX_AGE_MS, cooldownElapsed, isRecent, isValidEmail } from './notification.js';

test('validates e-mail addresses', () => {
  assert.equal(isValidEmail('operateur@aethercorp.test'), true);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail('a@b.c\nBcc: x@y.z'), false);
  assert.equal(isValidEmail(`${'a'.repeat(250)}@b.co`), false);
  assert.equal(isValidEmail(42), false);
});

test('waits for the cooldown between two e-mails', () => {
  const now = new Date('2026-10-06T10:05:00Z');
  assert.equal(cooldownElapsed(undefined, now, 300_000), true);
  assert.equal(cooldownElapsed(new Date('2026-10-06T10:01:00Z'), now, 300_000), false);
  assert.equal(cooldownElapsed(new Date('2026-10-06T10:00:00Z'), now, 300_000), true);
});

test('limits alert freshness in both directions with five seconds of clock tolerance', () => {
  const now = new Date('2026-10-06T10:05:00Z');
  assert.equal(isRecent(now, now), true);
  assert.equal(isRecent(new Date(+now - ALERT_MAX_AGE_MS), now), true);
  assert.equal(isRecent(new Date(+now - ALERT_MAX_AGE_MS - 1), now), false);
  assert.equal(isRecent(new Date(+now + ALERT_CLOCK_SKEW_MS), now), true);
  assert.equal(isRecent(new Date(+now + ALERT_CLOCK_SKEW_MS + 1), now), false);
  assert.equal(isRecent(new Date(+now + 24 * 3600_000), now), false);
  assert.equal(isRecent(new Date(NaN), now), false);
});
