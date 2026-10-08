// Composition root: the only place that knows every concrete implementation.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { AlertDetector } from './application/alert-detector.js';
import { AiCoordinator } from './application/ai-coordinator.js';
import { DeviceState } from './application/device-state.js';
import type { Clock, Mailer } from './application/ports.js';
import { CheckDeviceHeartbeat } from './application/use-cases/check-device-heartbeat.js';
import { GetDeviceStatus } from './application/use-cases/get-device-status.js';
import { GetReadingHistory } from './application/use-cases/get-reading-history.js';
import { GetRecentDetections } from './application/use-cases/get-recent-detections.js';
import {
  GetNotificationSettings,
  SendTestNotification,
  UpdateNotificationSettings,
} from './application/use-cases/notification-settings.js';
import { NotifyAlert } from './application/use-cases/notify-alert.js';
import { PruneReadingHistory } from './application/use-cases/prune-reading-history.js';
import { RecordDetection } from './application/use-cases/record-detection.js';
import { RecordTelemetry } from './application/use-cases/record-telemetry.js';
import { SendDeviceCommand } from './application/use-cases/send-device-command.js';
import {
  BetterAuthSessionVerifier,
  createAuth,
  createAuthHandler,
  ensureInitialAdmin,
} from './infrastructure/auth/better-auth.js';
import { HttpCameraFeed } from './infrastructure/camera/http-camera-feed.js';
import { HttpAiGateway } from './infrastructure/ai/http-ai-gateway.js';
import { config } from './infrastructure/config.js';
import { InMemoryLiveEvents } from './infrastructure/events/in-memory-live-events.js';
import { OutboxMailer } from './infrastructure/mail/outbox-mailer.js';
import { SmtpMailer } from './infrastructure/mail/smtp-mailer.js';
import { UnconfiguredMailer } from './infrastructure/mail/unconfigured-mailer.js';
import { MqttDeviceGateway } from './infrastructure/messaging/mqtt-device-gateway.js';
import { SqliteNotificationSettingsRepository } from './infrastructure/persistence/sqlite-notification-settings-repository.js';
import { SqliteReadingRepository } from './infrastructure/persistence/sqlite-reading-repository.js';
import { SqliteAiRepository } from './infrastructure/persistence/sqlite-ai-repository.js';
import { createHttpApp } from './presentation/http/app.js';

const RETENTION_MS = config.retentionDays * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 10_000;

function createMailer(): Mailer {
  const { smtp, outboxDirectory, from } = config.mail;
  if (smtp.host) return new SmtpMailer({ ...smtp, from });
  if (outboxDirectory) return new OutboxMailer(outboxDirectory, from);
  return new UnconfiguredMailer();
}

const clock: Clock = { now: () => new Date() };
const readings = new SqliteReadingRepository(config.telemetryDatabasePath);
const liveEvents = new InMemoryLiveEvents();
const deviceState = new DeviceState();
const aiPredictions = new SqliteAiRepository(config.telemetryDatabasePath);
const ai = new AiCoordinator(
  new HttpAiGateway(config.ai.url, config.ai.timeoutMs, config.ai.token), aiPredictions, liveEvents, clock, 32,
  !config.visionStreamUrl ? 'disabled' : config.ai.url && config.visionStreamUrl === `${config.ai.url.replace(/\/$/, '')}/stream.mjpg` ? 'ai' : 'external',
);
liveEvents.subscribe((event) => {
  if (event.type === 'reading') ai.enqueue(event.reading, event.source);
});
void ai.refresh();
const aiTimer = setInterval(() => void ai.refresh(), config.ai.pollMs);

const recordTelemetry = new RecordTelemetry(readings, deviceState, liveEvents, clock, RETENTION_MS);
const recordDetection = new RecordDetection(deviceState, liveEvents);
const gateway = new MqttDeviceGateway(
  config.mqttUrl,
  { telemetry: config.telemetryTopic, command: config.commandTopic, vision: config.visionTopic },
  {
    onTelemetry: (measurement) => recordTelemetry.execute(measurement),
    onDetection: (detection) => recordDetection.execute(detection),
  },
  { username: config.mqttUsername, password: config.mqttPassword },
);

// E-mail notifications: alerts raised by live events and by the box's silence.
const notificationSettings = new SqliteNotificationSettingsRepository(config.settingsDatabasePath);
const mailer = createMailer();
const notifyAlert = new NotifyAlert(notificationSettings, mailer, clock);
const alertDetector = new AlertDetector();
liveEvents.subscribe((event) => {
  const alert = alertDetector.fromEvent(event, clock.now());
  if (alert) void notifyAlert.execute(alert);
});
const checkHeartbeat = new CheckDeviceHeartbeat(deviceState, alertDetector, clock);
const heartbeatTimer = setInterval(() => {
  const alert = checkHeartbeat.execute();
  if (alert) void notifyAlert.execute(alert);
}, HEARTBEAT_INTERVAL_MS);

const pruneHistory = new PruneReadingHistory(readings, clock, RETENTION_MS);
function prune() {
  const removed = pruneHistory.execute();
  aiPredictions.deleteOlderThan(new Date(clock.now().getTime() - RETENTION_MS));
  if (removed > 0) console.info(`Pruned ${removed} readings older than ${config.retentionDays} days.`);
}
prune();
const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);

const auth = await createAuth();
await ensureInitialAdmin(config.initialAdmin.email, config.initialAdmin.passwordFile);
const app = createHttpApp({
  useCases: {
    getDeviceStatus: new GetDeviceStatus(deviceState, gateway),
    getReadingHistory: new GetReadingHistory(readings),
    getRecentDetections: new GetRecentDetections(deviceState),
    sendDeviceCommand: new SendDeviceCommand(gateway),
    getNotificationSettings: new GetNotificationSettings(notificationSettings, mailer),
    updateNotificationSettings: new UpdateNotificationSettings(notificationSettings),
    sendTestNotification: new SendTestNotification(notificationSettings, mailer, clock),
  },
  liveEvents,
  cameraFeed: new HttpCameraFeed(config.visionStreamUrl, config.ai.timeoutMs,
    config.ai.url && config.visionStreamUrl.startsWith(`${config.ai.url.replace(/\/$/, '')}/`) ? config.ai.token : ''),
  ai,
  sessions: new BetterAuthSessionVerifier(auth),
  authHandler: createAuthHandler(auth),
  frontendOrigins: config.frontendOrigins,
  trustProxy: config.trustProxy,
});

// HTTPS when a certificate is configured (production), plain HTTP for local development.
const server = config.tls.certFile
  ? createServer(
      { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile), minVersion: 'TLSv1.2' },
      app,
    ).listen(config.port, () => {
      console.info(`HTTPS server listening on https://localhost:${config.port}.`);
    })
  : app.listen(config.port, () => {
      console.info(`HTTP server listening on http://localhost:${config.port}.`);
    });

function shutdown(signal: string) {
  console.info(`Received ${signal}; shutting down.`);
  clearInterval(pruneTimer);
  clearInterval(heartbeatTimer);
  clearInterval(aiTimer);
  ai.stop();
  // Live streams (SSE, camera) never end on their own.
  server.closeAllConnections();
  server.close(() => {
    void gateway.close().then(() => {
      readings.close();
      notificationSettings.close();
      aiPredictions.close();
      process.exit(0);
    });
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
