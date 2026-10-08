export const ALERT_TYPES = ['intrusion', 'unknown-face', 'device-offline'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface Alert {
  type: AlertType;
  occurredAt: Date;
}

// Notifications are only sent by e-mail.
export interface NotificationSettings {
  email: string | null;
  enabled: boolean;
  alerts: Record<AlertType, boolean>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  email: null,
  enabled: false,
  alerts: { intrusion: true, 'unknown-face': true, 'device-offline': true },
};

// Minimum delay between two e-mails of the same alert type.
export const ALERT_COOLDOWN_MS = 5 * 60_000;
// An event older than this (e.g. replayed after an outage) raises no alert.
export const ALERT_MAX_AGE_MS = 60_000;
// Allow a small clock drift; future observations beyond five seconds are not live alerts.
export const ALERT_CLOCK_SKEW_MS = 5_000;
// The box publishes every 2 s; past this silence it is considered offline.
export const DEVICE_OFFLINE_AFTER_MS = 30_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function cooldownElapsed(lastSentAt: Date | undefined, now: Date, cooldownMs: number): boolean {
  return !lastSentAt || now.getTime() - lastSentAt.getTime() >= cooldownMs;
}

export function isRecent(occurredAt: Date, now: Date): boolean {
  const age = now.getTime() - occurredAt.getTime();
  return age >= -ALERT_CLOCK_SKEW_MS && age <= ALERT_MAX_AGE_MS;
}
