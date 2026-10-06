// Local test mode: simulated box (telemetry, LED commands) and vision service
// (detections over MQTT, video stream over HTTP), driven by one simulated scene.
import mqtt from 'mqtt';
import { SqliteReadingRepository } from '../infrastructure/persistence/sqlite-reading-repository.js';
import { startFakeCamera } from './fake-camera.js';
import { presenceAt, telemetryAt, visitorAt } from './simulated-scene.js';

const BROKER_URL = 'mqtt://127.0.0.1:1883';
const CAMERA_PORT = Number(process.env.SIMULATOR_CAMERA_PORT ?? 8090);
const INTERVAL_MS = 2000;
// History published at startup, with past timestamps, so the charts are full.
const BACKFILL_S = 300;

const client = mqtt.connect(BROKER_URL);
const camera = startFakeCamera(CAMERA_PORT);
let interval: ReturnType<typeof setInterval> | undefined;

function publishTelemetry(t: number, log: boolean) {
  const telemetry = { ...telemetryAt(t), ts: Math.floor(t) };
  client.publish('esp8266/donnees', JSON.stringify(telemetry), { qos: 1 }, (error) => {
    if (error) console.error('Publication simulee impossible :', error.message);
    else if (log) console.info('Mesure simulee :', JSON.stringify(telemetry));
  });
}

// Detections in the vision contract format (see infrastructure/messaging/messages.ts).
function publishVision(t: number) {
  const faces = presenceAt(t) === null ? [] : [{ name: visitorAt(t), confidence: visitorAt(t) ? 0.91 : 0.64 }];
  const detection = { ts: Math.floor(t), persons: faces.length, faces };
  client.publish('sentinel/vision', JSON.stringify(detection), { qos: 1 });
}

// Only fills the gap since the last stored reading, so restarts add no duplicates.
function backfill() {
  const store = new SqliteReadingRepository(process.env.TELEMETRY_DATABASE_PATH ?? 'data/telemetry.db');
  const latest = store.findRecent(1)[0];
  store.close();

  const now = Date.now() / 1000;
  const step = INTERVAL_MS / 1000;
  const from = Math.max(now - BACKFILL_S, latest ? latest.recordedAt.getTime() / 1000 + step : 0);
  let count = 0;
  for (let t = from; t < now - step / 2; t += step) {
    publishTelemetry(t, false);
    publishVision(t);
    count += 1;
  }
  if (count > 0) console.info(`Historique simule : ${count} mesures publiees.`);
}

function tick() {
  if (!client.connected) return;
  const t = Date.now() / 1000;
  publishTelemetry(t, true);
  publishVision(t);
}

client.on('connect', () => {
  client.subscribe('esp8266/led', { qos: 1 }, (error, granted) => {
    if (error || granted?.some((subscription) => subscription.qos === 128)) {
      console.error('Abonnement LED impossible.');
      client.end(true);
      process.exitCode = 1;
      return;
    }
    if (!interval) backfill();
    console.info(`Simulateur MQTT pret. Camera simulee : http://127.0.0.1:${CAMERA_PORT}/stream.mjpg`);
    tick();
    interval ??= setInterval(tick, INTERVAL_MS);
  });
});

client.on('message', (_topic, message) => {
  console.info('Commande LED simulee :', message.toString());
});
client.on('error', (error) => console.error('Erreur MQTT du simulateur :', error.message));

function shutdown() {
  clearInterval(interval);
  camera.close();
  client.end(true);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
