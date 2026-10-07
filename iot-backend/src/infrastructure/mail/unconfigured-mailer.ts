import type { Mailer } from '../../application/ports.js';

// No SMTP server configured: notifications are skipped and reported as such.
export class UnconfiguredMailer implements Mailer {
  isConfigured() {
    return false;
  }

  async send() {
    throw new Error('No mail transport is configured.');
  }
}
