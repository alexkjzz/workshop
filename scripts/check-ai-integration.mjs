// Run from any directory after: cd iot-backend; npm run build
// Then: node scripts/check-ai-integration.mjs (from the repository root).
// This uses isolated test data and a deliberately untrained Python service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AiCoordinator } from '../iot-backend/dist/application/ai-coordinator.js';
import { DeviceState } from '../iot-backend/dist/application/device-state.js';
import { RecordTelemetry } from '../iot-backend/dist/application/use-cases/record-telemetry.js';
import { GetDeviceStatus } from '../iot-backend/dist/application/use-cases/get-device-status.js';
import { GetReadingHistory } from '../iot-backend/dist/application/use-cases/get-reading-history.js';
import { GetRecentDetections } from '../iot-backend/dist/application/use-cases/get-recent-detections.js';
import { HttpAiGateway } from '../iot-backend/dist/infrastructure/ai/http-ai-gateway.js';
import { InMemoryLiveEvents } from '../iot-backend/dist/infrastructure/events/in-memory-live-events.js';
import { parseTelemetryMessage } from '../iot-backend/dist/infrastructure/messaging/messages.js';
import { SqliteAiRepository } from '../iot-backend/dist/infrastructure/persistence/sqlite-ai-repository.js';
import { SqliteReadingRepository } from '../iot-backend/dist/infrastructure/persistence/sqlite-reading-repository.js';
import { createHttpApp } from '../iot-backend/dist/presentation/http/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aiDirectory = join(root, 'ai');
const python = process.env.AI_TEST_PYTHON ?? join(aiDirectory, '.venv', 'Scripts', 'python.exe');
assert.ok(existsSync(python), 'Install ai/.venv and requirements-core.txt/requirements-test.txt first, or set AI_TEST_PYTHON.');
const runtimeRoot = join(root, '.runtime');
mkdirSync(runtimeRoot, { recursive: true });
const temporaryDirectory = mkdtempSync(join(runtimeRoot, 'ai-integration-'));
const relativeDirectory = relative(runtimeRoot, resolve(temporaryDirectory));
assert.ok(relativeDirectory && !relativeDirectory.startsWith('..') && !relativeDirectory.includes(sep),
  'Integration cleanup target must be a direct child of the workspace .runtime directory.');

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolvePromise, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolvePromise);
  });
  const port = socket.address().port;
  await new Promise((resolvePromise) => socket.close(resolvePromise));
  return port;
}

async function until(predicate, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

const pythonPort = await unusedPort();
const pythonUrl = `http://127.0.0.1:${pythonPort}`;
const token = randomUUID();
let pythonProcess;
let pythonLogs = '';
let pythonSpawnError;
let backendServer;
let sensorRepository;
let aiRepository;
let coordinator;
let unsubscribe;
let streamTask;
let streamFailure;
const streamAbort = new AbortController();

async function startPython() {
  pythonLogs = '';
  pythonSpawnError = undefined;
  const child = spawn(python, ['-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', String(pythonPort)], {
    cwd: aiDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AI_SERVICE_TOKEN: token,
      ANOMALY_MODEL: join(temporaryDirectory, 'intentionally-untrained.joblib'),
      YOLO_MODEL: join(temporaryDirectory, 'intentionally-unavailable.pt'),
      VISION_AUTO_START: 'false',
      PYTHONUNBUFFERED: '1',
    },
  });
  pythonProcess = child;
  child.on('error', (error) => { pythonSpawnError = error; });
  const collect = (chunk) => { pythonLogs = (pythonLogs + chunk.toString()).slice(-12_000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  await until(async () => {
    if (pythonSpawnError) throw pythonSpawnError;
    if (child.exitCode !== null) throw new Error(`Python exited with ${child.exitCode}: ${pythonLogs}`);
    try { return (await fetch(`${pythonUrl}/health`, { signal: AbortSignal.timeout(400) })).ok; }
    catch { return false; }
  }, 'isolated Python health endpoint', 30_000);
}

async function stopPython() {
  const child = pythonProcess;
  pythonProcess = undefined;
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
  // This is the child created by this script; no existing service is touched.
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5000, undefined, { ref: false })]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1000, undefined, { ref: false })]);
  }
}

function firmwareMeasurement(overrides = {}) {
  // MQTT contract of the USB bridge; unavailable climate fields are omitted.
  // Fixtures remain confined to this isolated SQLite database and HTTP server.
  const message = JSON.stringify({
    device: 'sentinel-x-integration', ts: Math.floor(Date.now() / 1000),
    gas: 123, presence: false, source: 'simulation',
    climateValid: false, gasReady: true, pirReady: true, gasAlert: false,
    alarmActive: false, ledRed: false, ledOrange: true, ledGreen: false, ...overrides,
  });
  const measurement = parseTelemetryMessage(message);
  assert.ok(measurement, 'Firmware JSON must cross the existing MQTT parser.');
  return measurement;
}

try {
  await startPython();
  console.log('PASS isolated Python service started with an intentionally absent model and no camera.');
  assert.equal((await fetch(`${pythonUrl}/status`)).status, 401, 'Python token must protect service metadata.');

  const databasePath = join(temporaryDirectory, 'telemetry.db');
  sensorRepository = new SqliteReadingRepository(databasePath);
  aiRepository = new SqliteAiRepository(databasePath);
  const events = new InMemoryLiveEvents();
  const state = new DeviceState();
  const clock = { now: () => new Date() };
  const gateway = new HttpAiGateway(pythonUrl, 1000, token);
  coordinator = new AiCoordinator(gateway, aiRepository, events, clock);
  unsubscribe = events.subscribe((event) => {
    if (event.type === 'reading') coordinator.enqueue(event.reading, event.source);
  });
  const record = new RecordTelemetry(sensorRepository, state, events, clock, 7 * 24 * 60 * 60 * 1000);
  const app = createHttpApp({
    useCases: {
      getDeviceStatus: new GetDeviceStatus(state, { isConnected: () => false }),
      getReadingHistory: new GetReadingHistory(sensorRepository),
      getRecentDetections: new GetRecentDetections(state),
    },
    liveEvents: events, ai: coordinator,
    cameraFeed: { isConfigured: () => false, open: async () => null },
    // Authentication fixture is confined to this ephemeral test server.
    sessions: { verify: async (headers) => headers.get('cookie') === 'integration=session' ? {
      userName: 'Integration', userEmail: 'integration@localhost', expiresAt: new Date(Date.now() + 120_000),
    } : null },
    authHandler: (_request, response) => { response.statusCode = 404; response.end(); },
    frontendOrigins: [], trustProxy: 'loopback',
  });
  backendServer = app.listen(0, '127.0.0.1');
  await new Promise((resolvePromise) => backendServer.once('listening', resolvePromise));
  const backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
  const authenticated = { headers: { Cookie: 'integration=session' } };
  assert.equal((await fetch(`${backendUrl}/api/ai/status`)).status, 401);
  assert.equal((await fetch(`${backendUrl}/api/stream`)).status, 401);
  const stream = await fetch(`${backendUrl}/api/stream`, { ...authenticated, signal: streamAbort.signal });
  assert.equal(stream.status, 200);
  const streamed = [];
  streamTask = (async () => {
    let pending = '';
    const decoder = new TextDecoder();
    const reader = stream.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const entry = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const type = /^event: (.+)$/m.exec(entry)?.[1];
          const payload = /^data: (.+)$/m.exec(entry)?.[1];
          if (type && payload) streamed.push({ type, payload: JSON.parse(payload) });
        }
      }
    } catch (error) { if (!streamAbort.signal.aborted) streamFailure = error; }
    finally { reader.releaseLock(); }
  })();

  await coordinator.refresh();
  assert.equal(coordinator.getStatus().online, true);
  assert.equal(coordinator.getStatus().model_loaded, false);
  const first = record.execute(firmwareMeasurement());
  await until(() => coordinator.getLatest()?.sample_id === first.id && coordinator.getStatus().queue_depth === 0,
    'firmware reading -> Python prediction -> SQLite');
  const prediction = coordinator.getLatest();
  assert.equal(prediction.anomaly.status, 'untrained');
  assert.equal(prediction.anomaly.is_anomaly, null);
  assert.equal(prediction.anomaly.anomaly_score, null);
  assert.equal(prediction.risk.degraded, true);
  assert.equal(prediction.source, 'simulation');
  assert.equal(first.source, 'simulation');
  assert.equal(sensorRepository.findRecent(1)[0].source, 'simulation');
  assert.equal(sensorRepository.findRecent(1)[0].climateValid, false);
  assert.equal(sensorRepository.findRecent(1)[0].ledOrange, true);
  const status = await (await fetch(`${backendUrl}/api/status`, authenticated)).json();
  assert.equal(status.telemetry.gasReady, true);
  assert.equal(status.telemetry.pirReady, true);
  assert.equal(status.telemetry.alarmActive, false);
  assert.equal(status.telemetry.ledOrange, true);
  const readingsResponse = await (await fetch(`${backendUrl}/api/readings?limit=1`, authenticated)).json();
  assert.equal(readingsResponse.readings[0].climateValid, false);
  assert.equal(readingsResponse.readings[0].ledGreen, false);
  await until(() => streamed.some((event) => event.type === 'reading'
    && event.payload.id === first.id && event.payload.ledOrange === true), 'ESP flags in authenticated SSE');
  assert.equal(aiRepository.findRecent(1)[0].id, prediction.id);
  await until(() => streamed.some((event) => event.type === 'ai' && event.payload.sample_id === first.id),
    'authenticated AI SSE event');
  assert.equal((await (await fetch(`${backendUrl}/api/ai/latest`, authenticated)).json()).id, prediction.id);
  console.log('PASS partial firmware reading -> untrained analysis -> shared SQLite -> authenticated SSE/REST.');

  const historyCount = coordinator.getHistory(50).length;
  await coordinator.refresh();
  assert.equal(coordinator.getHistory(50).length, historyCount, 'Status polling must deduplicate predictions.');
  assert.equal(coordinator.getStatus().vision.status, 'stopped');
  const stopResponse = await fetch(`${backendUrl}/api/ai/vision/stop`, { ...authenticated, method: 'POST' });
  assert.equal(stopResponse.status, 200);
  assert.equal((await stopResponse.json()).status, 'stopped');
  await coordinator.refresh();
  assert.equal(coordinator.getStatus().online, true);
  assert.equal(coordinator.getStatus().vision.person_count, 0);
  console.log('PASS vision control/status polling with no hardware and no duplicated inference result.');

  await stopPython();
  const beforeOutage = coordinator.getLatest().id;
  const duringOutage = record.execute(firmwareMeasurement({ temperature: 24.5, humidity: 55, climateValid: true }));
  await until(() => coordinator.getStatus().queue_depth === 0, 'outage sample to leave inference queue');
  await coordinator.refresh();
  assert.equal(coordinator.getStatus().online, false);
  assert.equal(coordinator.getLatest().id, beforeOutage, 'Outage must retain the previous result rather than invent a prediction.');
  assert.equal(sensorRepository.findRecent(1)[0].id, duringOutage.id, 'Telemetry remains stored during outage.');
  assert.equal((await fetch(`${backendUrl}/api/health`)).status, 200);
  await until(() => streamed.some((event) => event.type === 'ai-status' && event.payload.online === false), 'offline AI SSE');
  console.log('PASS Python outage keeps backend health, sensor persistence and previous AI result.');

  await startPython();
  await coordinator.refresh();
  assert.equal(coordinator.getStatus().online, true);
  const recovered = record.execute(firmwareMeasurement({ temperature: 24.6, humidity: 54, climateValid: true, presence: 0, source: 'live' }));
  await until(() => coordinator.getLatest()?.sample_id === recovered.id && coordinator.getStatus().queue_depth === 0,
    'AI inference after Python restart');
  assert.equal(coordinator.getLatest().source, 'live');
  assert.equal(coordinator.getLatest().anomaly.status, 'untrained');
  assert.equal(sensorRepository.findRecent(1)[0].source, 'live');
  assert.deepEqual(sensorRepository.findRecent(3).map(({ source }) => source), ['live', 'simulation', 'simulation']);
  assert.equal('source' in state.latest().telemetry, false, 'Provenance must not change sensor state shape.');
  await until(() => streamed.some((event) => event.type === 'ai' && event.payload.sample_id === recovered.id), 'recovered AI SSE');
  console.log('PASS restart recovery and separate persisted live/simulation provenance.');
  assert.equal(streamFailure, undefined, 'Authenticated SSE stream must remain connected.');
  console.log('AI integration check passed. MQTT transport and physical webcam are intentionally outside this local contract test.');
} catch (error) {
  console.error(error);
  if (pythonLogs) console.error('Owned Python process output:\n' + pythonLogs);
  process.exitCode = 1;
} finally {
  unsubscribe?.();
  coordinator?.stop();
  streamAbort.abort();
  await streamTask;
  if (backendServer) {
    backendServer.closeAllConnections();
    await new Promise((resolvePromise) => backendServer.close(resolvePromise));
  }
  await stopPython();
  sensorRepository?.close();
  aiRepository?.close();
  // The resolved target was checked above and is the only directory created by this run.
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
