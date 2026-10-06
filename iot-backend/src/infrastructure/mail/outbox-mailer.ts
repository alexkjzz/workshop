import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer, MailMessage } from '../../application/ports.js';

// Local test mode: e-mails are written as .eml files instead of being sent.
export class OutboxMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    private readonly directory: string,
    private readonly from: string,
  ) {
    mkdirSync(directory, { recursive: true });
    this.transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }

  isConfigured() {
    return true;
  }

  async send(message: MailMessage) {
    const info = await this.transporter.sendMail({ from: this.from, ...message });
    const file = join(this.directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.eml`);
    writeFileSync(file, info.message as Buffer);
    console.info(`E-mail written to ${file}.`);
  }
}
