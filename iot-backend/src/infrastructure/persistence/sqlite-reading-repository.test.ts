import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteReadingRepository } from './sqlite-reading-repository.js';

test('stores readings and returns the most recent first', () => {
  const repository = new SqliteReadingRepository(':memory:');
  repository.save({ temperature: 21.5, presence: false }, new Date('2026-10-06T10:00:00Z'));
  repository.save({ gas: 130 }, new Date('2026-10-06T10:00:04Z'));
  repository.save({ humidity: 48, presence: true }, new Date('2026-10-06T10:00:02Z'));

  assert.deepEqual(
    repository.findRecent(2).map(({ id: _id, ...reading }) => reading),
    [
      { recordedAt: new Date('2026-10-06T10:00:04Z'), gas: 130 },
      { recordedAt: new Date('2026-10-06T10:00:02Z'), humidity: 48, presence: true },
    ],
  );
  repository.close();
});

test('deletes readings older than a date', () => {
  const repository = new SqliteReadingRepository(':memory:');
  repository.save({ gas: 100 }, new Date('2026-09-01T00:00:00Z'));
  repository.save({ gas: 110 }, new Date('2026-10-06T00:00:00Z'));
  assert.equal(repository.deleteOlderThan(new Date('2026-10-01T00:00:00Z')), 1);
  assert.equal(repository.findRecent(10).length, 1);
  repository.close();
});
