import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { NotificationSettingsRepository } from '../../application/ports.js';
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../../domain/notification.js';

// Installation-wide notification settings: a single row in SQLite.
export class SqliteNotificationSettingsRepository implements NotificationSettingsRepository {
  private readonly db: DatabaseSync;
  private readonly selectStatement: StatementSync;
  private readonly upsertStatement: StatementSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email TEXT,
        enabled INTEGER NOT NULL,
        alerts TEXT NOT NULL
      );
    `);
    this.selectStatement = this.db.prepare('SELECT email, enabled, alerts FROM notification_settings WHERE id = 1');
    this.upsertStatement = this.db.prepare(`
      INSERT INTO notification_settings (id, email, enabled, alerts) VALUES (1, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET email = excluded.email, enabled = excluded.enabled, alerts = excluded.alerts
    `);
  }

  get(): NotificationSettings {
    const row = this.selectStatement.get() as { email: string | null; enabled: number; alerts: string } | undefined;
    if (!row) return DEFAULT_NOTIFICATION_SETTINGS;
    return {
      email: row.email,
      enabled: row.enabled === 1,
      // Alert types added later default to enabled.
      alerts: { ...DEFAULT_NOTIFICATION_SETTINGS.alerts, ...(JSON.parse(row.alerts) as Partial<NotificationSettings['alerts']>) },
    };
  }

  save(settings: NotificationSettings) {
    this.upsertStatement.run(settings.email, Number(settings.enabled), JSON.stringify(settings.alerts));
  }

  close() {
    this.db.close();
  }
}
