import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../domain/notification.js';
import { SqliteNotificationSettingsRepository } from './sqlite-notification-settings-repository.js';

test('returns defaults, then the saved settings', () => {
  const repository = new SqliteNotificationSettingsRepository(':memory:');
  assert.deepEqual(repository.get(), DEFAULT_NOTIFICATION_SETTINGS);
  const settings = {
    email: 'ops@aethercorp.test',
    enabled: true,
    alerts: { intrusion: true, 'unknown-face': false, 'device-offline': true },
  };
  repository.save(settings);
  repository.save({ ...settings, enabled: false });
  assert.deepEqual(repository.get(), { ...settings, enabled: false });
  repository.close();
});
