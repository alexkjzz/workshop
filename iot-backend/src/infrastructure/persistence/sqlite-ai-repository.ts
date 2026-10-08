import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { AiPredictionRepository } from '../../application/ports.js';
import type { AiPrediction, StoredAiPrediction } from '../../domain/ai.js';

interface PredictionRow { id: number; payload: string }

function toPrediction(row: PredictionRow): StoredAiPrediction {
  return { ...JSON.parse(row.payload) as AiPrediction, id: row.id };
}

// A separate table in the existing telemetry database; sensor history is untouched.
export class SqliteAiRepository implements AiPredictionRepository {
  private readonly db: DatabaseSync;
  private readonly insert: StatementSync;
  private readonly recent: StatementSync;
  private readonly byKey: StatementSync;
  private readonly remove: StatementSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS ai_predictions (
        id INTEGER PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        recorded_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_predictions_recorded_at ON ai_predictions (recorded_at);
    `);
    this.insert = this.db.prepare('INSERT OR IGNORE INTO ai_predictions (event_key, recorded_at, payload) VALUES (?, ?, ?)');
    this.recent = this.db.prepare('SELECT id, payload FROM ai_predictions ORDER BY recorded_at DESC, id DESC LIMIT ?');
    this.byKey = this.db.prepare('SELECT id, payload FROM ai_predictions WHERE event_key = ?');
    this.remove = this.db.prepare('DELETE FROM ai_predictions WHERE recorded_at < ?');
  }

  save(prediction: AiPrediction): StoredAiPrediction {
    const key = `${prediction.timestamp}:${prediction.sample_id ?? 'vision'}`;
    this.insert.run(key, Date.parse(prediction.timestamp), JSON.stringify(prediction));
    return toPrediction(this.byKey.get(key) as unknown as PredictionRow);
  }

  findRecent(limit: number): StoredAiPrediction[] {
    return (this.recent.all(limit) as unknown as PredictionRow[]).map(toPrediction);
  }

  deleteOlderThan(date: Date): number {
    return Number(this.remove.run(date.getTime()).changes);
  }

  close() { this.db.close(); }
}
