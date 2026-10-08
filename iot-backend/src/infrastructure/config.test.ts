import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readSecret } from './config.js';

test('reads a secret from NAME_FILE before NAME', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-secret-'));
  const file = join(directory, 'secret');
  writeFileSync(file, 'from-file\n');
  process.env.SENTINEL_TEST_SECRET = 'from-env';
  assert.equal(readSecret('SENTINEL_TEST_SECRET'), 'from-env');
  process.env.SENTINEL_TEST_SECRET_FILE = file;
  assert.equal(readSecret('SENTINEL_TEST_SECRET'), 'from-file');
  delete process.env.SENTINEL_TEST_SECRET;
  delete process.env.SENTINEL_TEST_SECRET_FILE;
  assert.equal(readSecret('SENTINEL_TEST_SECRET'), '');
  rmSync(directory, { recursive: true });
});
