import assert from 'node:assert/strict';
import test from 'node:test';
import { aiPrediction } from '../../testing/ai-fixture.js';
import { SqliteAiRepository } from './sqlite-ai-repository.js';

test('persists full predictions, deduplicates polling and prunes history', () => {
  const repository = new SqliteAiRepository(':memory:');
  try {
    const older = aiPrediction(1, '2026-10-05T10:00:00Z');
    const recent = aiPrediction(2, '2026-10-06T10:00:00Z');
    const first = repository.save(older);
    assert.deepEqual(repository.save(older), first);
    repository.save(recent);
    assert.deepEqual(repository.findRecent(2).map(({ sample_id }) => sample_id), [2, 1]);
    assert.equal(repository.findRecent(2)[0].anomaly.anomaly_score, 0.12);
    assert.equal(repository.deleteOlderThan(new Date('2026-10-06T00:00:00Z')), 1);
    assert.equal(repository.findRecent(10).length, 1);
  } finally { repository.close(); }
});
