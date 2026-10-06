const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

export const config = {
  port,
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  telemetryTopic: process.env.MQTT_TELEMETRY_TOPIC ?? 'esp8266/donnees',
  commandTopic: process.env.MQTT_COMMAND_TOPIC ?? 'esp8266/led',
  frontendOrigins: (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};