import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ReadingRepository } from '../../application/ports.js';
import type { Reading, Telemetry } from '../../domain/telemetry.js';

interface ReadingRow {
  id: number;
  recorded_at: number;
  temperature: number | null;
  humidity: number | null;
  gas: number | null;
  presence: number | null;
}

function toReading(row: ReadingRow): Reading {
  const reading: Reading = { id: row.id, recordedAt: new Date(row.recorded_at) };
  if (row.temperature !== null) reading.temperature = row.temperature;
  if (row.humidity !== null) reading.humidity = row.humidity;
  if (row.gas !== null) reading.gas = row.gas;
  if (row.presence !== null) reading.presence = row.presence === 1;
  return reading;
}

// Sensor history on the local server (Raspberry Pi), in SQLite.
export class SqliteReadingRepository implements ReadingRepository {
  private readonly db: DatabaseSync;
  private readonly insertStatement: StatementSync;
  private readonly recentStatement: StatementSync;
  private readonly deleteStatement: StatementSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY,
        recorded_at INTEGER NOT NULL,
        temperature REAL,
        humidity REAL,
        gas REAL,
        presence INTEGER
      );
      CREATE INDEX IF NOT EXISTS readings_recorded_at ON readings (recorded_at);
    `);
    this.insertStatement = this.db.prepare(
      'INSERT INTO readings (recorded_at, temperature, humidity, gas, presence) VALUES (?, ?, ?, ?, ?)',
    );
    this.recentStatement = this.db.prepare(
      'SELECT * FROM readings ORDER BY recorded_at DESC, id DESC LIMIT ?',
    );
    this.deleteStatement = this.db.prepare('DELETE FROM readings WHERE recorded_at < ?');
  }

  save(telemetry: Telemetry, recordedAt: Date): Reading {
    const result = this.insertStatement.run(
      recordedAt.getTime(),
      telemetry.temperature ?? null,
      telemetry.humidity ?? null,
      telemetry.gas ?? null,
      telemetry.presence === undefined ? null : Number(telemetry.presence),
    );
    return { id: Number(result.lastInsertRowid), recordedAt, ...telemetry };
  }

  findRecent(limit: number): Reading[] {
    return (this.recentStatement.all(limit) as unknown as ReadingRow[]).map(toReading);
  }

  deleteOlderThan(date: Date): number {
    return Number(this.deleteStatement.run(date.getTime()).changes);
  }

  close() {
    this.db.close();
  }
}
