const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const frontendOrigins = (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port,
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  telemetryTopic: process.env.MQTT_TELEMETRY_TOPIC ?? 'esp8266/donnees',
  commandTopic: process.env.MQTT_COMMAND_TOPIC ?? 'esp8266/led',
  frontendOrigins,
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
