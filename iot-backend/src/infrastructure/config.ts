const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const retentionDays = Number(process.env.READINGS_RETENTION_DAYS ?? 7);

if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
  throw new Error('READINGS_RETENTION_DAYS must be a positive number.');
}

const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const aiServiceUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';
if (aiServiceUrl && !['http:', 'https:'].includes(new URL(aiServiceUrl).protocol)) {
  throw new Error('AI_SERVICE_URL must be an HTTP URL, or empty to disable AI.');
}
const aiTimeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 5000);
const aiPollMs = Number(process.env.AI_POLL_MS ?? 2000);
if (!Number.isFinite(aiTimeoutMs) || aiTimeoutMs < 100 || !Number.isFinite(aiPollMs) || aiPollMs < 250) {
  throw new Error('AI_TIMEOUT_MS must be at least 100 and AI_POLL_MS at least 250.');
}

export const config = {
  port,
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  telemetryTopic: process.env.MQTT_TELEMETRY_TOPIC ?? 'esp8266/donnees',
  commandTopic: process.env.MQTT_COMMAND_TOPIC ?? 'esp8266/led',
  visionTopic: process.env.MQTT_VISION_TOPIC ?? 'sentinel/vision',
  // MJPEG stream of the AI team's vision script, relayed behind authentication.
  visionStreamUrl: process.env.VISION_STREAM_URL ?? (aiServiceUrl ? `${aiServiceUrl.replace(/\/$/, '')}/stream.mjpg` : ''),
  ai: { url: aiServiceUrl, timeoutMs: aiTimeoutMs, pollMs: aiPollMs, token: process.env.AI_SERVICE_TOKEN ?? '' },
  telemetryDatabasePath: process.env.TELEMETRY_DATABASE_PATH ?? 'data/telemetry.db',
  retentionDays,
  settingsDatabasePath: process.env.SETTINGS_DATABASE_PATH ?? 'data/settings.db',
  mail: {
    from: process.env.MAIL_FROM ?? 'SENTINEL-X <sentinel-x@localhost>',
    // Local test mode: e-mails are written to this directory instead of being sent.
    outboxDirectory: process.env.MAIL_OUTBOX_DIR ?? '',
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 587),
      // true: implicit TLS (port 465); false: STARTTLS, required.
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
    },
  },
  frontendOrigins,
  // Express "trust proxy" value: only these proxies may report the client IP.
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',
};

export function loadAuthConfig() {
  const secret = process.env.BETTER_AUTH_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to at least 32 characters (openssl rand -base64 32).',
    );
  }

  return {
    secret,
    // Public URL of the web interface; the Vite proxy forwards /api/auth to this server.
    baseURL: process.env.BETTER_AUTH_URL ?? frontendOrigins[0] ?? `http://127.0.0.1:${port}`,
    databasePath: process.env.AUTH_DATABASE_PATH ?? 'data/auth.db',
    trustedOrigins: frontendOrigins,
  };
}
