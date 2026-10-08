import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ReadingRepository } from '../../application/ports.js';
import { DEVICE_FLAG_KEYS, type DeviceFlags, type Reading, type Telemetry } from '../../domain/telemetry.js';

interface ReadingRow {
  id: number;
  recorded_at: number;
  temperature: number | null;
  humidity: number | null;
  gas: number | null;
  presence: number | null;
  source: 'live' | 'simulation' | null;
  device_flags: string | null;
}

function readDeviceFlags(serialized: string | null): DeviceFlags {
  if (!serialized) return {};
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(DEVICE_FLAG_KEYS
      .filter((key) => typeof (value as Record<string, unknown>)[key] === 'boolean')
      .map((key) => [key, (value as Record<string, unknown>)[key]])) as DeviceFlags;
  } catch {
    // A malformed optional status must not hide the remaining sensor history.
    return {};
  }
}

function toReading(row: ReadingRow): Reading {
  const reading: Reading = { id: row.id, recordedAt: new Date(row.recorded_at), ...readDeviceFlags(row.device_flags) };
  if (row.temperature !== null) reading.temperature = row.temperature;
  if (row.humidity !== null) reading.humidity = row.humidity;
  if (row.gas !== null) reading.gas = row.gas;
  if (row.presence !== null) reading.presence = row.presence === 1;
  if (row.source === 'live' || row.source === 'simulation') reading.source = row.source;
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
        presence INTEGER,
        source TEXT CHECK (source IN ('live', 'simulation')),
        device_flags TEXT
      );
      CREATE INDEX IF NOT EXISTS readings_recorded_at ON readings (recorded_at);
    `);
    // Existing sensor history predates provenance; never relabel it as real data.
    const columns = this.db.prepare('PRAGMA table_info(readings)').all() as unknown as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === 'source')) {
      this.db.exec("ALTER TABLE readings ADD COLUMN source TEXT CHECK (source IN ('live', 'simulation'))");
    }
    if (!columns.some(({ name }) => name === 'device_flags')) {
      this.db.exec('ALTER TABLE readings ADD COLUMN device_flags TEXT');
    }
    this.insertStatement = this.db.prepare(
      'INSERT INTO readings (recorded_at, temperature, humidity, gas, presence, source, device_flags) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    this.recentStatement = this.db.prepare(
      'SELECT * FROM readings ORDER BY recorded_at DESC, id DESC LIMIT ?',
    );
    this.deleteStatement = this.db.prepare('DELETE FROM readings WHERE recorded_at < ?');
  }

  save(telemetry: Telemetry, recordedAt: Date, source: 'live' | 'simulation' = 'live'): Reading {
    const flags = Object.fromEntries(DEVICE_FLAG_KEYS
      .filter((key) => typeof telemetry[key] === 'boolean')
      .map((key) => [key, telemetry[key]]));
    const result = this.insertStatement.run(
      recordedAt.getTime(),
      telemetry.temperature ?? null,
      telemetry.humidity ?? null,
      telemetry.gas ?? null,
      telemetry.presence === undefined ? null : Number(telemetry.presence),
      source,
      Object.keys(flags).length ? JSON.stringify(flags) : null,
    );
    return { id: Number(result.lastInsertRowid), recordedAt, ...telemetry, source };
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
