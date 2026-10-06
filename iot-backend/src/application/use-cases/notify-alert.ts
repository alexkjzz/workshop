import { ALERT_COOLDOWN_MS, cooldownElapsed, type Alert, type AlertType } from '../../domain/notification.js';
import { alertMessage } from '../alert-messages.js';
import type { Clock, Mailer, NotificationSettingsRepository } from '../ports.js';

export type NotificationOutcome = 'sent' | 'disabled' | 'cooldown' | 'unavailable' | 'failed';

export class NotifyAlert {
  private readonly lastSent = new Map<AlertType, Date>();

  constructor(
    private readonly settings: NotificationSettingsRepository,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  async execute(alert: Alert): Promise<NotificationOutcome> {
    const { email, enabled, alerts } = this.settings.get();
    if (!enabled || !email || !alerts[alert.type]) return 'disabled';

    const now = this.clock.now();
    if (!cooldownElapsed(this.lastSent.get(alert.type), now, ALERT_COOLDOWN_MS)) return 'cooldown';
    if (!this.mailer.isConfigured()) {
      console.warn(`Alert ${alert.type} not e-mailed: no mail transport configured.`);
      return 'unavailable';
    }

    this.lastSent.set(alert.type, now);
    try {
      await this.mailer.send({ to: email, ...alertMessage(alert) });
      console.info(`Alert ${alert.type} e-mailed.`);
      return 'sent';
    } catch (error) {
      console.error(`Alert ${alert.type} could not be e-mailed.`, error instanceof Error ? error.message : error);
      return 'failed';
    }
  }
}
