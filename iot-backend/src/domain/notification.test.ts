import assert from 'node:assert/strict';
import test from 'node:test';
import { cooldownElapsed, isValidEmail } from './notification.js';

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
