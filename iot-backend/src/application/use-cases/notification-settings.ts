import {
  ALERT_TYPES,
  cooldownElapsed,
  isValidEmail,
  type NotificationSettings,
} from '../../domain/notification.js';
import { testMessage } from '../alert-messages.js';
import {
  InvalidRequestError,
  MailDeliveryError,
  MailUnavailableError,
  RateLimitedError,
} from '../errors.js';
import type { Clock, Mailer, NotificationSettingsRepository } from '../ports.js';

const TEST_COOLDOWN_MS = 30_000;

export interface NotificationSettingsView {
  settings: NotificationSettings;
  mailConfigured: boolean;
}

export class GetNotificationSettings {
  constructor(
    private readonly settings: NotificationSettingsRepository,
    private readonly mailer: Mailer,
  ) {}

  execute(): NotificationSettingsView {
    return { settings: this.settings.get(), mailConfigured: this.mailer.isConfigured() };
  }
}

function parseSettings(input: unknown): NotificationSettings {
  if (typeof input !== 'object' || input === null) throw new InvalidRequestError('Invalid settings.');
  const { email, enabled, alerts } = input as Record<string, unknown>;

  const normalizedEmail = typeof email === 'string' ? email.trim() : email;
  if (normalizedEmail !== null && normalizedEmail !== '' && !isValidEmail(normalizedEmail)) {
    throw new InvalidRequestError('Invalid e-mail address.');
  }
  if (typeof enabled !== 'boolean') throw new InvalidRequestError('enabled must be a boolean.');
  if (typeof alerts !== 'object' || alerts === null) throw new InvalidRequestError('Invalid alerts.');
  const flags = alerts as Record<string, unknown>;
  if (ALERT_TYPES.some((type) => typeof flags[type] !== 'boolean')) {
    throw new InvalidRequestError('Each alert must be enabled or disabled.');
  }

  const address = normalizedEmail ? (normalizedEmail as string) : null;
  if (enabled && !address) throw new InvalidRequestError('An e-mail address is required to enable notifications.');
  return {
    email: address,
    enabled,
    alerts: Object.fromEntries(ALERT_TYPES.map((type) => [type, flags[type]])) as NotificationSettings['alerts'],
  };
}

export class UpdateNotificationSettings {
  constructor(private readonly settings: NotificationSettingsRepository) {}

  execute(input: unknown): NotificationSettings {
    const settings = parseSettings(input);
    this.settings.save(settings);
    return settings;
  }
}

export class SendTestNotification {
  private lastSentAt: Date | undefined;

  constructor(
    private readonly settings: NotificationSettingsRepository,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<string> {
    const { email } = this.settings.get();
    if (!email) throw new InvalidRequestError('Save an e-mail address first.');
    if (!this.mailer.isConfigured()) throw new MailUnavailableError('No mail transport is configured (SMTP).');

    const now = this.clock.now();
    if (!cooldownElapsed(this.lastSentAt, now, TEST_COOLDOWN_MS)) {
      throw new RateLimitedError('Wait 30 seconds between two test e-mails.');
    }
    this.lastSentAt = now;
    try {
      await this.mailer.send({ to: email, ...testMessage(now) });
    } catch {
      throw new MailDeliveryError('The test e-mail could not be sent.');
    }
    return email;
  }
}
