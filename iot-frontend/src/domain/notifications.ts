export const ALERT_TYPES = ['intrusion', 'unknown-face', 'device-offline'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

// Notifications are only sent by e-mail.
export interface NotificationSettings {
  email: string | null;
  enabled: boolean;
  alerts: Record<AlertType, boolean>;
}

export interface NotificationSettingsView {
  settings: NotificationSettings;
  // false when the server has no mail transport (SMTP).
  mailConfigured: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}
