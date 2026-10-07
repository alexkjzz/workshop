import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteReadingRepository } from './sqlite-reading-repository.js';

test('stores readings and returns the most recent first', () => {
  const repository = new SqliteReadingRepository(':memory:');
  repository.save({ temperature: 21.5, presence: false }, new Date('2026-10-06T10:00:00Z'));
  repository.save({ gas: 130 }, new Date('2026-10-06T10:00:04Z'));
  repository.save({ humidity: 48, presence: true }, new Date('2026-10-06T10:00:02Z'));

  assert.deepEqual(
    repository.findRecent(2).map(({ id: _id, ...reading }) => reading),
    [
      { recordedAt: new Date('2026-10-06T10:00:04Z'), gas: 130, source: 'live' },
      { recordedAt: new Date('2026-10-06T10:00:02Z'), humidity: 48, presence: true, source: 'live' },
    ],
  );
  repository.close();
});

test('migrates legacy history without guessing its source and persists live/simulation provenance', () => {
  const tempRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(tempRoot, 'sentinel-reading-test-'));
  assert.ok(resolve(directory).startsWith(`${tempRoot}${sep}`));
  const path = join(directory, 'telemetry.db');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE readings (
    id INTEGER PRIMARY KEY, recorded_at INTEGER NOT NULL,
    temperature REAL, humidity REAL, gas REAL, presence INTEGER
  ); INSERT INTO readings (recorded_at, gas) VALUES (1791280000000, 120);`);
  legacy.close();
  let repository: SqliteReadingRepository | undefined;
  try {
    repository = new SqliteReadingRepository(path);
    assert.equal(repository.findRecent(1)[0].source, undefined);
    repository.save({ gas: 130 }, new Date('2026-10-06T10:00:00Z'));
    repository.save({ gas: 140 }, new Date('2026-10-06T10:00:01Z'), 'simulation');
    assert.deepEqual(repository.findRecent(10).map(({ source }) => source), ['simulation', 'live', undefined]);
    repository.close();
    repository = new SqliteReadingRepository(path);
    assert.equal(repository.findRecent(1)[0].source, 'simulation');
  } finally {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deletes readings older than a date', () => {
  const repository = new SqliteReadingRepository(':memory:');
  repository.save({ gas: 100 }, new Date('2026-09-01T00:00:00Z'));
  repository.save({ gas: 110 }, new Date('2026-10-06T00:00:00Z'));
  assert.equal(repository.deleteOlderThan(new Date('2026-10-01T00:00:00Z')), 1);
  assert.equal(repository.findRecent(10).length, 1);
  repository.close();
});

test('persists boolean hardware state separately from sensor features', () => {
  const repository = new SqliteReadingRepository(':memory:');
  try {
    const telemetry = {
      temperature: 25.2, humidity: 47, gas: 650, presence: true,
      climateValid: true, gasReady: true, pirReady: true, gasAlert: true,
      alarmActive: true, ledRed: true, ledOrange: false, ledGreen: false,
    };
    const saved = repository.save(telemetry, new Date('2026-10-07T10:00:00Z'), 'live');
    assert.deepEqual(repository.findRecent(1), [saved]);
    const warmup = repository.save({ climateValid: false, gasReady: false, pirReady: false,
      alarmActive: false, ledOrange: true }, new Date('2026-10-07T10:00:01Z'));
    assert.deepEqual(repository.findRecent(1), [warmup]);
  } finally {
    repository.close();
  }
});

test('migrates existing sourced history and keeps hardware flags after reopening', () => {
  const tempRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(tempRoot, 'sentinel-flags-test-'));
  assert.ok(resolve(directory).startsWith(`${tempRoot}${sep}`));
  const path = join(directory, 'telemetry.db');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE readings (
    id INTEGER PRIMARY KEY, recorded_at INTEGER NOT NULL,
    temperature REAL, humidity REAL, gas REAL, presence INTEGER, source TEXT
  ); INSERT INTO readings (recorded_at, gas, source) VALUES (1791280000000, 120, 'live');`);
  legacy.close();
  let repository: SqliteReadingRepository | undefined;
  try {
    repository = new SqliteReadingRepository(path);
    const previous = repository.findRecent(1)[0];
    assert.equal(previous.source, 'live');
    assert.equal(previous.gas, 120);
    assert.equal(previous.gasReady, undefined);
    assert.equal(previous.alarmActive, undefined);
    const saved = repository.save({ gas: 610, gasReady: true, gasAlert: true,
      alarmActive: true, ledRed: true, ledGreen: false }, new Date('2026-10-07T10:00:00Z'));
    repository.close();
    repository = new SqliteReadingRepository(path);
    assert.deepEqual(repository.findRecent(2), [saved, previous]);
  } finally {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
