// Browser -> production Express -> real FastAPI enrollment, with synthetic photos
// and a deterministic face backend. This check never opens a camera.
// Build both projects first, then: node scripts/check-face-enrollment.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import express from '../iot-backend/node_modules/express/index.js';
import { preview } from '../iot-frontend/node_modules/vite/dist/node/index.js';
import { AiCoordinator } from '../iot-backend/dist/application/ai-coordinator.js';
import { DeviceState } from '../iot-backend/dist/application/device-state.js';
import { GetDeviceStatus } from '../iot-backend/dist/application/use-cases/get-device-status.js';
import { GetReadingHistory } from '../iot-backend/dist/application/use-cases/get-reading-history.js';
import { GetRecentDetections } from '../iot-backend/dist/application/use-cases/get-recent-detections.js';
import { HttpAiGateway } from '../iot-backend/dist/infrastructure/ai/http-ai-gateway.js';
import { InMemoryLiveEvents } from '../iot-backend/dist/infrastructure/events/in-memory-live-events.js';
import { SqliteAiRepository } from '../iot-backend/dist/infrastructure/persistence/sqlite-ai-repository.js';
import { SqliteReadingRepository } from '../iot-backend/dist/infrastructure/persistence/sqlite-reading-repository.js';
import { createHttpApp } from '../iot-backend/dist/presentation/http/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.AI_TEST_PYTHON ?? join(root, 'ai', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const browser = process.env.FACE_TEST_BROWSER ?? process.env.CAMERA_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
assert.ok(existsSync(python), 'Install ai/.venv or set AI_TEST_PYTHON.');
assert.ok(browser && existsSync(browser), 'Install Edge/Chrome/Chromium or set FACE_TEST_BROWSER.');
assert.ok(existsSync(join(root, 'iot-frontend', 'dist', 'index.html')), 'Build the frontend first.');
const runtime = join(root, '.runtime');
mkdirSync(runtime, { recursive: true });
const temporary = mkdtempSync(join(runtime, 'face-enrollment-integration-'));
function assertOwnedDirectory() {
  const child = relative(runtime, resolve(temporary));
  assert.ok(child && !child.startsWith('..') && !child.includes(sep) && child.startsWith('face-enrollment-integration-'),
    'Cleanup must stay inside the direct workspace .runtime child created by this check.');
}
assertOwnedDirectory();
const screenshot = join(runtime, `${basename(temporary)}.png`);

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
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((yes) => child.once('exit', yes));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
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
    await this.send('DOM.enable');
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

  async selectPhotos(files) {
    const document = await this.send('DOM.getDocument');
    const input = await this.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#face-enrollment-photos' });
    assert.ok(input.nodeId, 'The enrollment photo picker must exist.');
    await this.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files });
  }

  close() { this.socket?.close(); }
}

const token = randomUUID();
const pythonPort = await unusedPort();
const pythonUrl = `http://127.0.0.1:${pythonPort}`;
const directHeaders = { Authorization: `Bearer ${token}` };
const cdp = new DevTools();
const requests = [];
let pythonProcess, browserProcess, backendServer, frontend, coordinator, readings, predictions, polling;
let pythonOutput = '', browserOutput = '';

// No portraits or real models are involved. The actual app, photo decoder,
// filesystem enrollment, authentication middleware and proxy remain in use.
const pythonCode = `
import os
from pathlib import Path
import numpy as np
from PIL import Image
import uvicorn
from app.config import Settings
from app.main import create_app
from app.utils.logger import configure_logging
from app.vision.face_recognition import FaceRecognitionService

temporary = Path(os.environ["FACE_TEST_DIRECTORY"])
fixtures = temporary / "fixtures"
fixtures.mkdir()
for filename, shade in [("portrait.jpg", 150), ("second.png", 160), ("no-face.png", 10)]:
    Image.new("RGB", (120, 120), (shade, shade, shade)).save(fixtures / filename)

class SyntheticBackend:
    def load(self):
        pass
    def read_image(self, path):
        with Image.open(path) as image:
            return np.array(image.convert("RGB"))
    def detect(self, image):
        if round(float(image.mean())) == 10:
            return []
        return [np.array([10, 10, 80, 80, 30, 30, 70, 30, 50, 50, 35, 70, 65, 70, .99], dtype=np.float32)]
    def embedding(self, image, face):
        return np.array([1., 0.])

settings = Settings(service_token=os.environ["AI_SERVICE_TOKEN"],
    vision_auto_start=False, face_enabled=True, face_min_size=40,
    face_known_dir=temporary / "known_faces", model_path=temporary / "untrained.joblib",
    sensor_csv=temporary / "sensor_data.csv", yolo_model=temporary / "absent-yolo.pt")
app = create_app(settings)
app.state.engine.camera.faces = FaceRecognitionService(settings, SyntheticBackend())
def forbid_camera(*args, **kwargs):
    raise RuntimeError("TEST_CAMERA_GUARD: camera access is forbidden in this isolated test")
app.state.engine.camera.start = forbid_camera
app.state.engine.camera._open_camera = forbid_camera
configure_logging()
uvicorn.run(app, host="127.0.0.1", port=int(os.environ["FACE_TEST_PORT"]))
`;

try {
  let pythonError;
  pythonProcess = spawn(python, ['-c', pythonCode], {
    cwd: join(root, 'ai'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AI_SERVICE_TOKEN: token, FACE_TEST_DIRECTORY: temporary,
      FACE_TEST_PORT: String(pythonPort), VISION_AUTO_START: 'false', PYTHONUNBUFFERED: '1' },
  });
  pythonProcess.once('error', (error) => { pythonError = error; });
  const collectPython = (chunk) => { pythonOutput = (pythonOutput + chunk.toString()).slice(-10_000); };
  pythonProcess.stdout.on('data', collectPython);
  pythonProcess.stderr.on('data', collectPython);
  await until(async () => {
    if (pythonError) throw pythonError;
    if (pythonProcess.exitCode !== null) throw new Error(pythonOutput);
    try {
      const response = await fetch(`${pythonUrl}/vision/faces/status`, { headers: directHeaders, signal: AbortSignal.timeout(500) });
      return response.ok && (await response.json()).model_loaded;
    } catch { return false; }
  }, 'owned FastAPI with the synthetic facial backend', 30_000);
  assert.equal((await fetch(`${pythonUrl}/vision/faces/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const knownDirectory = join(temporary, 'known_faces');
  assert.equal(existsSync(knownDirectory) ? readdirSync(knownDirectory).length : 0, 0);

  readings = new SqliteReadingRepository(join(temporary, 'telemetry.db'));
  predictions = new SqliteAiRepository(join(temporary, 'telemetry.db'));
  const events = new InMemoryLiveEvents();
  const state = new DeviceState();
  const gateway = new HttpAiGateway(pythonUrl, 5000, token);
  coordinator = new AiCoordinator(gateway, predictions, events, { now: () => new Date() });
  await coordinator.refresh();
  polling = setInterval(() => void coordinator.refresh(), 500);
  const app = createHttpApp({
    useCases: {
      getDeviceStatus: new GetDeviceStatus(state, { isConnected: () => false }),
      getReadingHistory: new GetReadingHistory(readings), getRecentDetections: new GetRecentDetections(state),
    }, liveEvents: events, ai: coordinator,
    cameraFeed: { isConfigured: () => false, open: async () => { throw new Error('Camera streams are forbidden in this check.'); } },
    // The session fixture exists only on this ephemeral loopback test server.
    sessions: { verify: async (headers) => headers.get('cookie')?.includes('face-integration=session')
      ? { userName: 'Enrollment test', userEmail: 'enrollment@localhost', expiresAt: new Date(Date.now() + 120_000) } : null },
    authHandler: (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (!request.headers.cookie?.includes('face-integration=session')) { response.end('null'); return; }
      const date = new Date().toISOString();
      response.end(JSON.stringify({ user: { id: 'enrollment-test', name: 'Enrollment test', email: 'enrollment@localhost',
        emailVerified: true, createdAt: date, updatedAt: date }, session: { id: 'enrollment-session', token: 'fixture',
        userId: 'enrollment-test', expiresAt: new Date(Date.now() + 120_000).toISOString(), createdAt: date, updatedAt: date } }));
    }, frontendOrigins: [], trustProxy: 'loopback',
  });
  const monitored = express();
  monitored.use((request, response, next) => {
    requests.push({ method: request.method, path: request.path });
    if (request.method !== 'GET' && request.path !== '/api/ai/vision/faces/enroll') {
      response.status(405).json({ message: 'This check permits facial enrollment only; camera and device controls are blocked.' });
      return;
    }
    next();
  });
  monitored.use(app);
  backendServer = monitored.listen(0, '127.0.0.1');
  await new Promise((yes, no) => { backendServer.once('listening', yes); backendServer.once('error', no); });
  const backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
  assert.equal((await fetch(`${backendUrl}/api/ai/vision/faces/enroll`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  console.log('PASS real FastAPI and Express reject unauthenticated enrollment before any catalogue write.');

  frontend = await preview({ configFile: false, root: join(root, 'iot-frontend'),
    preview: { host: '127.0.0.1', port: await unusedPort(), strictPort: true,
      proxy: { '/api': { target: backendUrl, xfwd: true } } } });
  const frontendUrl = `http://127.0.0.1:${frontend.httpServer.address().port}`;
  const devToolsPort = await unusedPort();
  let browserError;
  browserProcess = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${devToolsPort}`, `--user-data-dir=${join(temporary, 'browser-profile')}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  browserProcess.once('error', (error) => { browserError = error; });
  const collectBrowser = (chunk) => { browserOutput = (browserOutput + chunk.toString()).slice(-3000); };
  browserProcess.stdout.on('data', collectBrowser);
  browserProcess.stderr.on('data', collectBrowser);
  let target;
  await until(async () => {
    if (browserError) throw browserError;
    if (browserProcess.exitCode !== null) throw new Error(browserOutput);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json();
      target = pages.find((page) => page.type === 'page');
      return Boolean(target);
    } catch { return false; }
  }, 'owned headless browser DevTools');
  await cdp.open(target.webSocketDebuggerUrl);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Network.setCookie', { name: 'face-integration', value: 'session', url: frontendUrl, httpOnly: true });
  await cdp.send('Page.navigate', { url: `${frontendUrl}/#/camera` });
  await until(() => cdp.evaluate("Boolean(document.querySelector('#face-enrollment-name') && !document.querySelector('.face-enrollment fieldset')?.disabled)"),
    'enabled enrollment form while the webcam is stopped');
  const before = requests.length;
  assert.equal(await cdp.evaluate(`(() => {
    const input = document.querySelector('#face-enrollment-name');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Mohamed');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`), 'Mohamed');
  await cdp.selectPhotos([join(temporary, 'fixtures', 'portrait.jpg'), join(temporary, 'fixtures', 'second.png')]);
  await until(() => cdp.evaluate("document.querySelectorAll('.face-photo-selection li').length === 2"), 'two locally selected reference photos');
  await until(() => cdp.evaluate("[...document.querySelectorAll('.face-photo-selection img')].every(image => image.naturalWidth === 120)"), 'local photo previews');
  const submit = async () => assert.equal(await cdp.evaluate(`(() => {
    const button = document.querySelector('.face-enroll-submit');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`), true, 'Enrollment submit must be enabled.');
  await submit();
  await until(() => cdp.evaluate("document.querySelector('.face-enrollment-feedback')?.innerText.includes('2 photo(s) ajoutée(s) pour Mohamed.')"),
    'successful two-photo enrollment feedback');
  await until(() => cdp.evaluate("document.querySelector('.face-catalog')?.innerText.includes('1 identité(s) connue(s) · 2 photo(s) de référence')"),
    'updated known identity and photo counters');
  assert.equal(await cdp.evaluate("document.querySelectorAll('.face-photo-selection li').length"), 0);
  const stored = readdirSync(join(knownDirectory, 'Mohamed'));
  assert.equal(stored.length, 2);
  assert.ok(stored.every((filename) => /^[0-9a-f-]+\.jpg$/i.test(filename)), 'Stored photos use generated JPEG names.');
  const acceptedCatalogue = await gateway.facesStatus();
  assert.equal(acceptedCatalogue.reference_images, 2);
  assert.deepEqual(acceptedCatalogue.identities, ['Mohamed']);
  assert.equal((await gateway.visionStatus()).status, 'stopped');
  console.log('PASS React uploads two selected photos through Express; real FastAPI stores two normalized JPEGs and reloads Mohamed.');

  await cdp.selectPhotos([join(temporary, 'fixtures', 'no-face.png')]);
  await until(() => cdp.evaluate("document.querySelectorAll('.face-photo-selection li').length === 1"), 'selected no-face fixture');
  await submit();
  await until(() => cdp.evaluate("document.querySelector('.face-enrollment-feedback')?.innerText.includes('Aucune photo n’a été ajoutée.')"),
    'honest zero-additions feedback');
  const rejection = await cdp.evaluate("document.querySelector('.face-enrollment-feedback')?.innerText");
  assert.match(rejection, /no-face\.png/);
  assert.match(rejection, /Aucun visage/);
  assert.equal(await cdp.evaluate("document.querySelectorAll('.face-photo-selection li').length"), 1,
    'Rejected photos must stay selected for correction.');
  assert.match(await cdp.evaluate("document.querySelector('.face-photo-selection')?.innerText"), /no-face\.png/);
  assert.deepEqual(readdirSync(join(knownDirectory, 'Mohamed')), stored);
  const rejectedCatalogue = await gateway.facesStatus();
  assert.equal(rejectedCatalogue.reference_images, 2);
  assert.equal(rejectedCatalogue.catalog_revision, acceptedCatalogue.catalog_revision);
  assert.equal((await gateway.visionStatus()).status, 'stopped');
  console.log('PASS a photo without a face produces a per-photo reason, keeps the selection and leaves the catalogue unchanged.');

  assert.equal(requests.slice(before).filter(({ method, path }) => method === 'POST' && path === '/api/ai/vision/faces/enroll').length, 2);
  assert.equal(requests.some(({ path }) => /\/vision\/(?:start|stop|stream)$/.test(path) || path === '/api/camera/stream' || path === '/api/action'), false);
  assert.equal(cdp.requests.filter((url) => /^https?:/.test(url)).every((url) => new URL(url).origin === frontendUrl), true,
    'Browser traffic must stay on the Express proxy origin; no direct FastAPI request is allowed.');
  assert.deepEqual(cdp.exceptions, []);
  assert.doesNotMatch(pythonOutput, /TEST_CAMERA_GUARD|Camera opened index=/);
  await cdp.evaluate("document.querySelector('.face-enrollment').scrollIntoView({block: 'start'})");
  const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(screenshot, Buffer.from(image.data, 'base64'));
  console.log('PASS the camera stayed stopped, browser JavaScript had no uncaught exceptions and all API traffic used Express.');
  console.log(`Screenshot: ${relative(root, screenshot)}`);
  console.log('Face enrollment integration passed with synthetic images and a deterministic facial backend; real recognition accuracy is not evaluated.');
} catch (error) {
  console.error(error);
  if (cdp.socket?.readyState === WebSocket.OPEN) {
    console.error('Browser state:', await cdp.evaluate("({text:document.body.innerText, inputs:[...document.querySelectorAll('.face-enrollment input')].map(input=>({id:input.id,value:input.type==='file'?'[local picker]':input.value})), buttons:[...document.querySelectorAll('.face-enrollment button')].map(button=>({text:button.textContent,disabled:button.disabled}))})").catch(() => 'unavailable'));
    console.error('Recent backend requests:', requests.slice(-20));
  }
  console.error('Owned Python output:\n' + pythonOutput);
  if (browserOutput) console.error('Owned browser output:\n' + browserOutput);
  process.exitCode = 1;
} finally {
  clearInterval(polling);
  coordinator?.stop();
  cdp.close();
  await terminate(browserProcess);
  if (frontend) { frontend.httpServer.closeAllConnections(); await new Promise((yes) => frontend.httpServer.close(yes)); }
  if (backendServer) { backendServer.closeAllConnections(); await new Promise((yes) => backendServer.close(yes)); }
  await terminate(pythonProcess);
  readings?.close();
  predictions?.close();
  assertOwnedDirectory();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
