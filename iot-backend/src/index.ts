import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { config } from './config.js';
import { MqttService } from './mqtt-service.js';

const auth = await createAuth();

const mqttService = new MqttService(
  config.mqttUrl,
  config.telemetryTopic,
  config.commandTopic,
);
const app = createApp(mqttService, auth, config.frontendOrigins);
const server = app.listen(config.port, () => {
  console.info(`HTTP server listening on http://localhost:${config.port}.`);
});

function shutdown(signal: string) {
  console.info(`Received ${signal}; shutting down.`);
  server.close(() => {
    void mqttService.close().then(() => process.exit(0));
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));