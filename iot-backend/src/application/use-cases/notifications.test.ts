import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../../domain/notification.js';
import { InvalidRequestError, MailUnavailableError, RateLimitedError } from '../errors.js';
import type { MailMessage } from '../ports.js';
import { SendTestNotification, UpdateNotificationSettings } from './notification-settings.js';
import { NotifyAlert } from './notify-alert.js';

function setup(settings: Partial<NotificationSettings> = {}, configured = true) {
  let stored: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...settings };
  const repository = { get: () => stored, save: (next: NotificationSettings) => (stored = next) };
  const sent: MailMessage[] = [];
  const mailer = { isConfigured: () => configured, send: async (message: MailMessage) => void sent.push(message) };
  let now = new Date('2026-10-06T10:00:00Z');
  const clock = { now: () => now, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  return { repository, mailer, clock, sent };
}

const alert = { type: 'intrusion' as const, occurredAt: new Date('2026-10-06T10:00:00Z') };

test('e-mails an alert, then waits for the cooldown', async () => {
  const { repository, mailer, clock, sent } = setup({ email: 'ops@aethercorp.test', enabled: true });
  const notify = new NotifyAlert(repository, mailer, clock);
  assert.equal(await notify.execute(alert), 'sent');
  assert.equal(sent[0].to, 'ops@aethercorp.test');
  assert.match(sent[0].subject, /Intrusion/);
  assert.equal(await notify.execute(alert), 'cooldown');
  clock.advance(5 * 60_000);
  assert.equal(await notify.execute(alert), 'sent');
});

test('respects disabled notifications and alert types', async () => {
  const disabled = setup({ email: 'ops@aethercorp.test', enabled: false });
  assert.equal(await new NotifyAlert(disabled.repository, disabled.mailer, disabled.clock).execute(alert), 'disabled');
  const typeOff = setup({
    email: 'ops@aethercorp.test',
    enabled: true,
    alerts: { ...DEFAULT_NOTIFICATION_SETTINGS.alerts, intrusion: false },
  });
  assert.equal(await new NotifyAlert(typeOff.repository, typeOff.mailer, typeOff.clock).execute(alert), 'disabled');
  const noMailer = setup({ email: 'ops@aethercorp.test', enabled: true }, false);
  assert.equal(await new NotifyAlert(noMailer.repository, noMailer.mailer, noMailer.clock).execute(alert), 'unavailable');
});

test('validates notification settings', () => {
  const { repository } = setup();
  const update = new UpdateNotificationSettings(repository);
  const alerts = DEFAULT_NOTIFICATION_SETTINGS.alerts;
  assert.deepEqual(update.execute({ email: ' ops@aethercorp.test ', enabled: true, alerts }), {
    email: 'ops@aethercorp.test',
    enabled: true,
    alerts,
  });
  assert.throws(() => update.execute({ email: 'invalid', enabled: false, alerts }), InvalidRequestError);
  assert.throws(() => update.execute({ email: '', enabled: true, alerts }), InvalidRequestError);
  assert.throws(() => update.execute({ email: null, enabled: false, alerts: { intrusion: 'yes' } }), InvalidRequestError);
  assert.deepEqual(update.execute({ email: '', enabled: false, alerts }).email, null);
});

test('sends a test e-mail with a cooldown', async () => {
  const { repository, mailer, clock, sent } = setup({ email: 'ops@aethercorp.test' });
  const sendTest = new SendTestNotification(repository, mailer, clock);
  assert.equal(await sendTest.execute(), 'ops@aethercorp.test');
  assert.equal(sent.length, 1);
  await assert.rejects(sendTest.execute(), RateLimitedError);

  const noAddress = setup();
  await assert.rejects(new SendTestNotification(noAddress.repository, noAddress.mailer, noAddress.clock).execute(), InvalidRequestError);
  const noMailer = setup({ email: 'ops@aethercorp.test' }, false);
  await assert.rejects(new SendTestNotification(noMailer.repository, noMailer.mailer, noMailer.clock).execute(), MailUnavailableError);
});
