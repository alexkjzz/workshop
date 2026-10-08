// Physical webcam + built React + Express + FastAPI. Uses isolated ports/data.
// Run from the root after building both projects: node scripts/check-camera-integration.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import express from '../iot-backend/node_modules/express/index.js';
import { preview } from '../iot-frontend/node_modules/vite/dist/node/index.js';
import { AiCoordinator } from '../iot-backend/dist/application/ai-coordinator.js';
import { DeviceState } from '../iot-backend/dist/application/device-state.js';
import { GetDeviceStatus } from '../iot-backend/dist/application/use-cases/get-device-status.js';
import { GetReadingHistory } from '../iot-backend/dist/application/use-cases/get-reading-history.js';
import { GetRecentDetections } from '../iot-backend/dist/application/use-cases/get-recent-detections.js';
import { HttpAiGateway } from '../iot-backend/dist/infrastructure/ai/http-ai-gateway.js';
import { HttpCameraFeed } from '../iot-backend/dist/infrastructure/camera/http-camera-feed.js';
import { InMemoryLiveEvents } from '../iot-backend/dist/infrastructure/events/in-memory-live-events.js';
import { SqliteAiRepository } from '../iot-backend/dist/infrastructure/persistence/sqlite-ai-repository.js';
import { SqliteReadingRepository } from '../iot-backend/dist/infrastructure/persistence/sqlite-reading-repository.js';
import { createHttpApp } from '../iot-backend/dist/presentation/http/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.AI_TEST_PYTHON ?? join(root, 'ai', '.venv', 'Scripts', 'python.exe');
const browser = process.env.CAMERA_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
assert.ok(existsSync(python), 'Install ai/.venv or set AI_TEST_PYTHON.');
assert.ok(browser && existsSync(browser), 'Install Edge/Chrome or set CAMERA_TEST_BROWSER.');
assert.ok(existsSync(join(root, 'iot-frontend', 'dist', 'index.html')), 'Build the frontend first.');
const runtime = join(root, '.runtime');
mkdirSync(runtime, { recursive: true });
const temporary = mkdtempSync(join(runtime, 'camera-integration-'));
const childDirectory = relative(runtime, resolve(temporary));
assert.ok(childDirectory && !childDirectory.startsWith('..') && !childDirectory.includes(sep),
  'Cleanup must stay inside the workspace .runtime directory.');

async function unusedPort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise((yes) => server.close(yes));
  return port;
}

async function until(check, description, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function terminate(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((yes) => child.once('exit', yes));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3000, undefined, { ref: false })]);
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
}

class DevTools {
  nextId = 0;
  pending = new Map();
  requests = [];
  exceptions = [];

  async open(url) {
    this.socket = new WebSocket(url);
    await new Promise((yes, no) => {
      this.socket.addEventListener('open', yes, { once: true });
      this.socket.addEventListener('error', no, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const call = this.pending.get(message.id);
      if (call) {
        clearTimeout(call.timer);
        this.pending.delete(message.id);
        if (message.error) call.no(new Error(JSON.stringify(message.error)));
        else call.yes(message.result);
      }
      if (message.method === 'Network.requestWillBeSent') this.requests.push(message.params.request.url);
      if (message.method === 'Runtime.exceptionThrown') this.exceptions.push(message.params.exceptionDetails.text);
    });
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((yes, no) => {
      const timer = setTimeout(() => { this.pending.delete(id); no(new Error(`DevTools timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { yes, no, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  close() { this.socket?.close(); }
}

const readOnly = process.env.CAMERA_TEST_READ_ONLY === '1';
const localEnv = readOnly && existsSync(join(root, 'ai', '.env'))
  ? parseEnv(readFileSync(join(root, 'ai', '.env'), 'utf8')) : {};
const token = readOnly ? process.env.AI_SERVICE_TOKEN ?? localEnv.AI_SERVICE_TOKEN ?? '' : randomUUID();
const pythonUrl = readOnly ? process.env.CAMERA_TEST_AI_URL ?? 'http://127.0.0.1:8001'
  : `http://127.0.0.1:${await unusedPort()}`;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(pythonUrl).hostname), 'Camera checks require a local AI service.');
const directHeaders = token ? { Authorization: `Bearer ${token}` } : {};
const sessionHeaders = { Cookie: 'integration=session' };
const cdp = new DevTools();
let pythonProcess, browserProcess, backendServer, frontend, coordinator, readings, predictions, polling;
let pythonOutput = '', browserOutput = '';
const activeStreams = new Set();
const requests = [];
let failNextStream = false;

try {
  let spawnError;
  if (!readOnly) {
    pythonProcess = spawn(python, ['-c',
      'import uvicorn; from app.main import create_app; from app.utils.logger import configure_logging; configure_logging(); uvicorn.run(create_app(), host="127.0.0.1", port=' + new URL(pythonUrl).port + ')'], {
      cwd: join(root, 'ai'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AI_SERVICE_TOKEN: token, VISION_CAMERA_INDEX: process.env.VISION_CAMERA_INDEX ?? '0',
        FACE_RECOGNITION_ENABLED: 'true', FACE_KNOWN_DIR: join(temporary, 'known_faces'),
        VISION_AUTO_START: 'false', ANOMALY_MODEL: join(temporary, 'untrained.joblib'), PYTHONUNBUFFERED: '1',
        ...(process.env.CAMERA_TEST_NO_YOLO === '1' ? { YOLO_MODEL: join(temporary, 'absent-yolo.pt') } : {}) },
    });
    pythonProcess.once('error', (error) => { spawnError = error; });
    const collectPython = (chunk) => { pythonOutput = (pythonOutput + chunk.toString()).slice(-10_000); };
    pythonProcess.stdout.on('data', collectPython);
    pythonProcess.stderr.on('data', collectPython);
    await until(async () => {
      if (spawnError) throw spawnError;
      if (pythonProcess.exitCode !== null) throw new Error(pythonOutput);
      try { return (await fetch(`${pythonUrl}/health`, { signal: AbortSignal.timeout(500) })).ok; }
      catch { return false; }
    }, 'FastAPI health', 30_000);
    assert.equal((await fetch(`${pythonUrl}/stream.mjpg`)).status, 401);
    assert.equal((await fetch(`${pythonUrl}/stream.mjpg`, { headers: directHeaders })).status, 503);
    assert.equal((await (await fetch(`${pythonUrl}/vision/status`, { headers: directHeaders })).json()).status, 'stopped');
  } else {
    const initial = await fetch(`${pythonUrl}/vision/status`, { headers: directHeaders, signal: AbortSignal.timeout(5000) });
    assert.equal(initial.status, 200, 'Start the local AI service before the read-only check.');
    await initial.json();
  }

  readings = new SqliteReadingRepository(join(temporary, 'telemetry.db'));
  predictions = new SqliteAiRepository(join(temporary, 'telemetry.db'));
  const events = new InMemoryLiveEvents();
  const state = new DeviceState();
  const gateway = new HttpAiGateway(pythonUrl, 5000, token);
  coordinator = new AiCoordinator(gateway, predictions, events, { now: () => new Date() });
  await coordinator.refresh();
  polling = setInterval(() => void coordinator.refresh(), 2000);
  const feed = new HttpCameraFeed(`${pythonUrl}/stream.mjpg`, 5000, token);
  const app = createHttpApp({
    useCases: {
      getDeviceStatus: new GetDeviceStatus(state, { isConnected: () => false }),
      getReadingHistory: new GetReadingHistory(readings), getRecentDetections: new GetRecentDetections(state),
    }, liveEvents: events, ai: coordinator,
    cameraFeed: { isConfigured: () => true, open: async (signal) => {
      const result = await feed.open(signal);
      if (result && !signal.aborted) {
        activeStreams.add(signal);
        signal.addEventListener('abort', () => activeStreams.delete(signal), { once: true });
      }
      return result;
    } },
    // This cookie/session fixture exists only in the ephemeral test server.
    sessions: { verify: async (headers) => headers.get('cookie')?.includes('integration=session')
      ? { userName: 'Camera test', userEmail: 'camera@localhost', expiresAt: new Date(Date.now() + 120_000) } : null },
    authHandler: (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (!request.headers.cookie?.includes('integration=session')) { response.end('null'); return; }
      const date = new Date().toISOString();
      response.end(JSON.stringify({ user: { id: 'camera-test', name: 'Camera test', email: 'camera@localhost',
        emailVerified: true, createdAt: date, updatedAt: date }, session: { id: 'camera-session', token: 'fixture',
        userId: 'camera-test', expiresAt: new Date(Date.now() + 120_000).toISOString(), createdAt: date, updatedAt: date } }));
    }, frontendOrigins: [], trustProxy: 'loopback',
  });
  const monitored = express();
  monitored.use((request, response, next) => {
    requests.push({ method: request.method, path: request.path });
    if (readOnly && request.method !== 'GET') {
      response.status(405).json({ message: 'Read-only camera display check.' });
      return;
    }
    if (failNextStream && request.path === '/api/camera/stream') {
      failNextStream = false;
      response.status(503).json({ message: 'Coupure temporaire pour vérifier Réessayer.' });
    } else next();
  });
  monitored.use(app);
  backendServer = monitored.listen(0, '127.0.0.1');
  await new Promise((yes) => backendServer.once('listening', yes));
  const backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
  assert.equal((await fetch(`${backendUrl}/api/ai/vision/status`)).status, 401);
  assert.equal((await fetch(`${backendUrl}/api/ai/vision/stream`)).status, 401);
  for (const action of ['status', 'latest', 'history', 'reload']) {
    const method = action === 'reload' ? 'POST' : 'GET';
    // Read-only monitoring rejects all mutations before the auth middleware.
    assert.equal((await fetch(`${backendUrl}/api/ai/vision/faces/${action}`, { method })).status,
      readOnly && method === 'POST' ? 405 : 401);
  }
  frontend = await preview({ configFile: false, root: join(root, 'iot-frontend'),
    preview: { host: '127.0.0.1', port: await unusedPort(), strictPort: true,
      proxy: { '/api': { target: backendUrl, xfwd: true } } } });
  const frontendUrl = `http://127.0.0.1:${frontend.httpServer.address().port}`;
  const devToolsPort = await unusedPort();
  browserProcess = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${devToolsPort}`, `--user-data-dir=${join(temporary, 'browser-profile')}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  browserProcess.once('error', (error) => { spawnError = error; });
  const collectBrowser = (chunk) => { browserOutput = (browserOutput + chunk.toString()).slice(-3000); };
  browserProcess.stdout.on('data', collectBrowser);
  browserProcess.stderr.on('data', collectBrowser);
  let target;
  await until(async () => {
    if (spawnError) throw spawnError;
    if (browserProcess.exitCode !== null) throw new Error(browserOutput);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json();
      target = pages.find((page) => page.type === 'page');
      return Boolean(target);
    } catch { return false; }
  }, 'headless browser DevTools');
  await cdp.open(target.webSocketDebuggerUrl);
  await cdp.send('Network.setCookie', { name: 'integration', value: 'session', url: frontendUrl, httpOnly: true });
  const before = requests.length;
  await cdp.send('Page.navigate', { url: frontendUrl + '/#/camera' });
  const click = async (prefix) => assert.equal(await cdp.evaluate(
    `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith(${JSON.stringify(prefix)})); if (!button || button.disabled) return false; button.click(); return true; })()`), true,
  `Button must be enabled: ${prefix}`);
  const imageReady = () => cdp.evaluate("Boolean(document.querySelector('.camera-frame img')?.naturalWidth)");
  const checkPanels = async (requireHistory) => {
    await until(() => cdp.evaluate("Boolean(document.querySelector('.person-detection-current'))"), 'camera results panels');
    if (requireHistory) {
      await until(() => cdp.evaluate("Boolean(document.querySelector('.person-detection tbody tr td:nth-child(4)'))"),
        'persisted real YOLO history in the camera page');
      await until(async () => {
        const vision = coordinator.getStatus().vision;
        if (!vision?.last_prediction_time || vision.detection_status !== 'running') return false;
        const label = await cdp.evaluate("document.querySelector('.person-detection-current')?.textContent");
        return vision.person_count > 0
          ? label?.includes(`${vision.person_count} personne`) : label?.startsWith('Aucune personne détectée lors de la dernière analyse.');
      }, 'React person count matching current real AI results');
    } else {
      const label = await cdp.evaluate("document.querySelector('.person-detection-current')?.textContent");
      assert.doesNotMatch(label, /Aucune personne détectée/, 'Missing/stopped detection cannot claim an empty camera view.');
    }
    const facial = await cdp.evaluate("document.querySelector('.facial-detection')?.innerText");
    assert.match(facial, /Reconnaissance faciale/);
    assert.match(facial, /photo\(s\) de référence/);
    assert.doesNotMatch(facial, /Aucune personne dans le champ/);
    assert.ok(requests.some(({ path }) => path === '/api/ai/history'));
    assert.ok(requests.some(({ path }) => path === '/api/stream'));
    assert.deepEqual(cdp.exceptions, []);
    if (requireHistory) console.log('PASS real YOLO person count and persisted detection history displayed through REST/SSE in React.');
    console.log('PASS separate facial recognition status/catalog displayed in React through Express.');
    if (!readOnly) {
      await until(async () => {
        const result = await gateway.facesStatus();
        return result.model_loaded && result.status === 'running' && result.last_prediction_time;
      }, 'real YuNet/SFace inference on physical webcam');
      const faces = await gateway.facesStatus();
      assert.equal(faces.known_identities, 0);
      console.log(`PASS real webcam facial module: ${faces.faces.length} current face(s), ${faces.history.length} event(s), zero known identities.`);
      await click('Recharger les visages connus');
      await until(() => requests.some(({ method, path }) => method === 'POST' && path === '/api/ai/vision/faces/reload'), 'facial reload through Express');
      await until(() => cdp.evaluate("Boolean([...document.querySelectorAll('button')].find(b => b.textContent === 'Recharger les visages connus' && !b.disabled))"), 'finished facial reload');
      assert.equal((await gateway.visionStatus()).status, 'running');
      // Rendering fixtures go only through the ephemeral test server's SSE feed.
      // They never enroll identities or alter real Python recognition results.
      clearInterval(polling);
      // Finish pending live refreshes before injecting a deterministic UI fixture.
      await delay(100);
      const stamp = new Date().toISOString();
      const known = { face_id: 'render-known', name: 'Mohamed', known: true, confidence: .91, similarity: .91,
        detection_confidence: .99, recognizable: true, reason: null, bbox: [20, 20, 100, 100], timestamp: stamp, tracker_id: 7 };
      const unknown = { ...known, face_id: 'render-unknown', name: 'Unknown', known: false, confidence: .2, similarity: .2, tracker_id: null };
      const fixture = { ...faces, status: 'running', known_identities: 1, identities: ['Mohamed'], reference_images: 3,
        timestamp: stamp, last_prediction_time: stamp, faces: [known, unknown], history: [known, unknown] };
      const current = coordinator.getStatus();
      await until(async () => {
        events.publish({ type: 'ai-status', status: { ...current, vision: { ...current.vision,
          faces: fixture } } });
        return cdp.evaluate("document.querySelectorAll('.face-recognition-card').length === 2");
      }, 'recognized and unknown rendering fixtures');
      const cards = await cdp.evaluate("[...document.querySelectorAll('.face-recognition-card')].map(card => card.innerText)");
      assert.match(cards[0], /Mohamed/); assert.match(cards[0], /Connu/); assert.match(cards[0], /91 %/); assert.match(cards[0], /#7/);
      assert.match(cards[1], /Inconnu/);
      assert.equal(await cdp.evaluate("document.querySelectorAll('.facial-detection tbody tr').length"), 2);
      events.publish({ type: 'ai-status', status: current });
      polling = setInterval(() => void coordinator.refresh(), 2000);
      console.log('PASS React renders Mohamed / Connu / 91% / Track #7, Unknown and recognition history from SSE fixtures.');
    }
  };
  if (readOnly) {
    const vision = coordinator.getStatus().vision;
    const detecting = vision?.status === 'running' && vision.detection_status === 'running';
    if (detecting) await until(imageReady, 'existing webcam image in React');
    await checkPanels(detecting);
    assert.equal(requests.slice(before).filter(({ method }) => method !== 'GET').length, 0,
      'The read-only browser check cannot mutate camera/catalog state.');
    console.log('Read-only camera display check passed; the existing camera state is preserved.');
  } else {
    await until(() => cdp.evaluate("Boolean([...document.querySelectorAll('button')].find(b => b.textContent === 'Démarrer la webcam' && !b.disabled))"), 'enabled webcam start');
    assert.equal(requests.slice(before).filter(({ path }) => path.includes('/stream') && path !== '/api/stream').length, 0,
      'React must not request MJPEG while stopped.');
    await click('Démarrer la webcam');
    await until(imageReady, 'React displaying the physical MJPEG image');
    const vision = await coordinator.getVisionStatus();
    assert.equal(vision.status, 'running');
    assert.equal(vision.stream_ready, true);
    assert.ok(vision.last_frame_time);
    const dimensions = await cdp.evaluate("[document.querySelector('.camera-frame img').naturalWidth, document.querySelector('.camera-frame img').naturalHeight]");
    assert.deepEqual(dimensions, [640, 480]);
    console.log('PASS React Start -> Express -> FastAPI -> DirectShow -> MJPEG image 640x480.');

    // A second viewer receives a real JPEG without opening another webcam.
    const second = await fetch(`${backendUrl}/api/ai/vision/stream`, { headers: sessionHeaders });
    assert.equal(second.status, 200);
    assert.match(second.headers.get('content-type'), /multipart\/x-mixed-replace; boundary=frame/);
    const reader = second.body.getReader();
    const bytes = await reader.read();
    assert.ok(Buffer.from(bytes.value).includes(Buffer.from([0xff, 0xd8])), 'Proxy must send actual JPEG bytes immediately.');
    await reader.cancel();
    await until(() => activeStreams.size === 1, 'second viewer disconnect cancelling upstream');
    const stopStart = Date.now();
    await click('Arrêter la webcam');
    await until(async () => !(await cdp.evaluate("Boolean(document.querySelector('.camera-frame img'))")), 'React removing stopped stream', 2000);
    await until(async () => (await coordinator.getVisionStatus()).status === 'stopped', 'released webcam');
    await until(() => activeStreams.size === 0, 'stopped stream disconnect');
    assert.ok(Date.now() - stopStart < 5000);
    assert.equal((await fetch(`${backendUrl}/api/camera/stream`, { headers: sessionHeaders })).status, 503);
    console.log('PASS second viewer, disconnect cancellation, immediate stop, released camera and meaningful HTTP 503.');

    // Force one failed browser stream, then exercise the actual React retry button.
    await until(() => cdp.evaluate("Boolean([...document.querySelectorAll('button')].find(b => b.textContent === 'Démarrer la webcam' && !b.disabled))"), 'restart button');
    failNextStream = true;
    await click('Démarrer la webcam');
    await until(() => cdp.evaluate("Boolean([...document.querySelectorAll('button')].find(b => b.textContent === 'Réessayer'))"), 'stream failure retry');
    const starts = requests.filter(({ path, method }) => path === '/api/ai/vision/start' && method === 'POST').length;
    await click('Réessayer');
    await until(imageReady, 'physical video after retry');
    assert.equal(requests.filter(({ path, method }) => path === '/api/ai/vision/start' && method === 'POST').length, starts + 1);
    assert.equal(cdp.requests.filter((url) => /^https?:/.test(url)).every((url) => new URL(url).origin === frontendUrl), true,
      'Browser must only use same-origin Express proxy routes.');
    assert.deepEqual(cdp.exceptions, []);
    await until(async () => (await coordinator.getVisionStatus()).detection_status ===
      (process.env.CAMERA_TEST_NO_YOLO === '1' ? 'unavailable' : 'running'), 'independent YOLO status', 60_000);
    console.log(process.env.CAMERA_TEST_NO_YOLO === '1'
      ? 'PASS real MJPEG remains available with missing YOLO weights.'
      : 'PASS YOLO/ByteTrack inference resumes independently of video after restart.');
    await checkPanels(process.env.CAMERA_TEST_NO_YOLO !== '1');
    assert.equal((pythonOutput.match(/Camera opened index=/g) ?? []).length, 2,
      'Start/retry/second viewer must share one device; only stop/restart may reopen it.');
    await click('Arrêter la webcam');
    await until(() => activeStreams.size === 0, 'final stream cleanup');
    console.log('PASS physical camera restart, React Retry repeats start/status/stream, and no direct browser-to-Python traffic.');
    console.log('Camera integration check passed. No frames saved; existing services and production authentication are untouched.');
  }
} catch (error) {
  console.error(error);
  if (cdp.socket?.readyState === WebSocket.OPEN) {
    console.error('Browser state:', await cdp.evaluate("({text: document.body.innerText, buttons: [...document.querySelectorAll('button')].map(b => ({text:b.textContent, disabled:b.disabled})), image: document.querySelector('.camera-frame img')?.src})").catch(() => 'unavailable'));
    console.error('Recent backend requests:', requests.slice(-20));
  }
  console.error('Owned Python output:\n' + pythonOutput);
  if (browserOutput) console.error('Owned browser output:\n' + browserOutput);
  process.exitCode = 1;
} finally {
  clearInterval(polling);
  cdp.close();
  await terminate(browserProcess);
  if (frontend) { frontend.httpServer.closeAllConnections(); await new Promise((yes) => frontend.httpServer.close(yes)); }
  if (coordinator) {
    if (!readOnly) await coordinator.controlVision('stop').catch(() => {});
    coordinator.stop();
  }
  if (backendServer) { backendServer.closeAllConnections(); await new Promise((yes) => backendServer.close(yes)); }
  await terminate(pythonProcess);
  readings?.close();
  predictions?.close();
  // Only the verified workspace child directory created by this run is removed.
  rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
