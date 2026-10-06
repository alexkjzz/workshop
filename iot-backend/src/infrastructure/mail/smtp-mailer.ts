import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from '../../application/ports.js';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
      // STARTTLS is required when the connection does not start in TLS.
      requireTLS: !settings.secure,
    });
  }

  isConfigured() {
    return true;
  }

  async send(message: MailMessage) {
    await this.transporter.sendMail({ from: this.settings.from, ...message });
  }
}
