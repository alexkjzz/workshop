// Isolated visual/responsive QA against the built frontend and local GET-only fixtures.
// Build iot-frontend first, then run: node scripts/check-frontend-style.mjs
// No application backend, FastAPI, camera, broker, device command or e-mail is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import express from '../iot-backend/node_modules/express/index.js';
import { preview } from '../iot-frontend/node_modules/vite/dist/node/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, '.runtime');
const browser = process.env.STYLE_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync);
assert.ok(browser && existsSync(browser), 'Install Edge/Chrome/Chromium or set STYLE_TEST_BROWSER.');
assert.ok(existsSync(join(root, 'iot-frontend', 'dist', 'index.html')), 'Build iot-frontend before running this check.');
mkdirSync(runtime, { recursive: true });
const temporary = mkdtempSync(join(runtime, 'frontend-style-check-'));
const artifactPrefix = basename(temporary);

function assertOwnedDirectory() {
  const child = relative(resolve(runtime), resolve(temporary));
  assert.ok(child && !child.startsWith('..') && !child.includes(sep)
    && child.startsWith('frontend-style-check-') && dirname(resolve(temporary)) === resolve(runtime),
  'Cleanup must stay inside the direct .runtime child created by this check.');
}
assertOwnedDirectory();

async function unusedPort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise((yes) => server.close(yes));
  return port;
}

async function until(check, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(75);
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
  networkFailures = [];

  async open(url) {
    this.socket = new WebSocket(url);
    await new Promise((yes, no) => {
      this.socket.addEventListener('open', yes, { once: true });
      this.socket.addEventListener('error', no, { once: true });
    });
    const failPending = () => {
      for (const call of this.pending.values()) {
        clearTimeout(call.timer);
        call.no(new Error('Owned browser DevTools connection closed.'));
      }
      this.pending.clear();
    };
    this.socket.addEventListener('close', failPending);
    this.socket.addEventListener('error', failPending);
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
      if (message.method === 'Network.loadingFailed') {
        this.networkFailures.push({ type: message.params.type, error: message.params.errorText,
          canceled: message.params.canceled ?? false });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params.exceptionDetails;
        this.exceptions.push(detail.exception?.description ?? detail.text);
      }
    });
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}, timeout = 10_000) {
    const id = ++this.nextId;
    return new Promise((yes, no) => {
      if (this.socket?.readyState !== WebSocket.OPEN) { no(new Error(`DevTools connection is not open: ${method}`)); return; }
      const timer = setTimeout(() => { this.pending.delete(id); no(new Error(`DevTools timeout: ${method}`)); }, timeout);
      this.pending.set(id, { yes, no, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  async tab() {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }

  close() { this.socket?.close(); }
}

// These values are exclusively fixtures on the ephemeral loopback server below.
// They are never written to the application, a device, or production storage.
function fixture() {
  const time = Date.now();
  const timestamp = new Date(time).toISOString();
  const past = new Date(time - 120_000).toISOString();
  const telemetry = { temperature: 24.6, humidity: 48.2, gas: 273, presence: false,
    climateValid: true, gasReady: true, pirReady: true, gasAlert: false, alarmActive: false,
    ledRed: false, ledOrange: false, ledGreen: true };
  const catalog = { enabled: true, status: 'stopped', model_loaded: true,
    known_identities: 1, reference_images: 3, skipped_images: 0, identities: ['Mohamed'], threshold: .55,
    faces: [], history: [{ face_id: 'style-fixture-face', name: 'Mohamed', known: true,
      confidence: .91, similarity: .91, detection_confidence: .99, recognizable: true, reason: null,
      bbox: [10, 10, 90, 110], timestamp: past, tracker_id: 7 }], timestamp,
    last_prediction_time: null, loaded_at: past, inference_time_ms: 0, error: null,
    reload_error: null, reloading: false, catalog_revision: 1 };
  const vision = { status: 'stopped', error: null, person_detected: false, person_count: 0,
    max_confidence: 0, confirmed: false, objects: [], timestamp, fps: 0, inference_time_ms: 0,
    last_prediction_time: null, stream_ready: false, detection_status: 'stopped', faces: catalog };
  const aiStatus = { camera_source: 'ai', online: true, model_loaded: true, vision,
    last_success_at: timestamp, last_error: null, queue_depth: 0, dropped_samples: 0 };
  const prediction = { id: 1, sample_id: 90, sensor_timestamp: timestamp, timestamp, source: 'live', vision,
    anomaly: { status: 'ready', is_anomaly: false, anomaly_score: .18, confidence: .82,
      reason: 'Fixture de contrôle visuel.', features: { temperature: 24.6, humidity: 48.2, gas: 273, presence: 0 },
      missing_fields: [], timestamp },
    risk: { risk_score: 0, risk_level: 'SAFE', category: 'SAFE', reasons: ['Vision unavailable or stale'],
      confidence: .42, degraded: true, timestamp } };
  const readings = Array.from({ length: 90 }, (_, index) => ({ ...telemetry, id: index + 1,
    recordedAt: new Date(time - (89 - index) * 2000).toISOString(),
    temperature: Number((24.6 + Math.sin(index / 10) * .4).toFixed(1)),
    humidity: Number((48.2 + Math.cos(index / 12) * 1.1).toFixed(1)), gas: 273 + Math.round(Math.sin(index / 7) * 12) }));
  return { timestamp, telemetry, catalog, vision, aiStatus, prediction, readings };
}

const requests = [];
const sseClients = new Set();
const report = { fixtureOnly: true, cases: [], screenshots: [] };
const cdp = new DevTools();
let backendServer, frontend, browserProcess, browserOutput = '', frontendUrl, activeCase;

function localFixtureApi() {
  const app = express();
  app.use((request, response, next) => {
    requests.push({ method: request.method, path: request.path });
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.status(405).json({ message: 'This isolated style check permits GET fixtures only.' });
      return;
    }
    next();
  });
  app.get('/api/auth/get-session', (request, response) => {
    if (!request.headers.cookie?.includes('frontend-style-session=active')) { response.json(null); return; }
    const date = new Date().toISOString();
    response.json({ user: { id: 'style-check-user', name: 'Opérateur Sentinel-X', email: 'style-check@localhost',
      emailVerified: true, createdAt: date, updatedAt: date },
    session: { id: 'style-check-session', token: 'fixture-only', userId: 'style-check-user',
      expiresAt: new Date(Date.now() + 120_000).toISOString(), createdAt: date, updatedAt: date } });
  });
  app.use('/api', (request, response, next) => {
    if (!request.headers.cookie?.includes('frontend-style-session=active')) {
      response.status(401).json({ message: 'Fixture session required.' }); return;
    }
    next();
  });
  app.get('/api/status', (_request, response) => {
    const data = fixture();
    response.json({ mqttConnected: true, lastMessageAt: data.timestamp, telemetry: data.telemetry });
  });
  app.get('/api/readings', (_request, response) => response.json({ readings: fixture().readings }));
  app.get(['/api/vision', '/api/vision/detections'], (_request, response) => response.json({ detections: [] }));
  app.get('/api/ai/status', (_request, response) => response.json(fixture().aiStatus));
  app.get('/api/ai/latest', (_request, response) => response.json(fixture().prediction));
  app.get('/api/ai/history', (_request, response) => response.json({ predictions: [fixture().prediction] }));
  app.get('/api/ai/vision/status', (_request, response) => response.json(fixture().vision));
  app.get('/api/ai/vision/faces/status', (_request, response) => response.json(fixture().catalog));
  app.get('/api/ai/vision/faces/latest', (_request, response) => response.json({ faces: [], timestamp: null, status: 'stopped' }));
  app.get('/api/ai/vision/faces/history', (_request, response) => response.json({ faces: fixture().catalog.history }));
  app.get('/api/settings/notifications', (_request, response) => response.json({ mailConfigured: true,
    settings: { email: 'operateur.sentinel-x@exemple.fr', enabled: true,
      alerts: { intrusion: true, 'unknown-face': true, 'device-offline': true } } }));
  app.get('/api/stream', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    sseClients.add(response);
    response.write('retry: 60000\n\n');
    const send = () => {
      const data = fixture();
      response.write(`event: ai-status\ndata: ${JSON.stringify(data.aiStatus)}\n\n`);
      response.write(`event: reading\ndata: ${JSON.stringify(data.readings.at(-1))}\n\n`);
    };
    send();
    const heartbeat = setInterval(send, 3000);
    response.once('close', () => { clearInterval(heartbeat); sseClients.delete(response); });
  });
  app.use((request, response) => response.status(404).json({ message: `No style fixture for ${request.path}.` }));
  return app;
}

async function checkKeyboardNavigation() {
  const reached = new Set();
  // Navigation is at the start of the document; Tab never activates a command.
  await cdp.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
  for (let index = 0; index < 18 && reached.size < 3; index++) {
    await cdp.tab();
    const focused = await cdp.evaluate(`(() => {
      const element = document.activeElement;
      if (!element?.matches('.topbar-nav a')) return null;
      const style = getComputedStyle(element);
      return { href: element.getAttribute('href'), visible: element.matches(':focus-visible'),
        ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' };
    })()`);
    if (focused) {
      assert.ok(focused.visible && focused.ring, `Keyboard focus must remain visible on ${focused.href}.`);
      reached.add(focused.href);
    }
  }
  assert.deepEqual([...reached].sort(), ['#/camera', '#/metrics', '#/settings']);
  await cdp.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
}

async function inspectLayout(page, width) {
  return cdp.evaluate(`(() => {
    const visible = element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const identify = element => element.id || element.className || element.tagName;
    const buttonMinimum = ${width < 640 ? 44 : 40};
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const fields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')].filter(visible);
    const badButtons = buttons.filter(element => element.getBoundingClientRect().height < buttonMinimum - .5)
      .map(element => ({ element: identify(element), height: element.getBoundingClientRect().height }));
    const badFields = fields.filter(element => {
      const box = element.getBoundingClientRect();
      return box.height < 39.5 || box.width < 40 || box.left < -.5 || box.right > innerWidth + .5;
    }).map(element => ({ element: identify(element), box: element.getBoundingClientRect().toJSON() }));
    const nav = [...document.querySelectorAll('.topbar-nav a')].map(element => {
      const box = element.getBoundingClientRect();
      return { href: element.getAttribute('href'), name: element.getAttribute('aria-label') || element.textContent.trim(),
        visible: visible(element), tabIndex: element.tabIndex, height: box.height,
        withinViewport: box.left >= -.5 && box.right <= innerWidth + .5, current: element.getAttribute('aria-current') };
    });
    const checkboxes = [...document.querySelectorAll('input[type=checkbox]')].filter(visible);
    const badCheckboxTargets = ${width < 640} ? checkboxes.filter(element => {
      const label = element.closest('label');
      return !label || label.getBoundingClientRect().height < 43.5;
    }).map(identify) : [];
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth;
    const overflowExamples = overflow > 1 ? [...document.querySelectorAll('body *')].filter(visible)
      .filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8)
      .map(element => ({ element: identify(element), right: element.getBoundingClientRect().right })) : [];
    return { page: ${JSON.stringify(page)}, viewport: innerWidth, overflow, overflowExamples,
      buttonCount: buttons.length, fieldCount: fields.length, badButtons, badFields, badCheckboxTargets, nav,
      theme: document.documentElement.dataset.theme, background: getComputedStyle(document.body).backgroundColor };
  })()`);
}

async function inspectContrast() {
  return cdp.evaluate(`(() => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = value => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const blend = (foreground, background) => foreground.slice(0, 3)
      .map((channel, index) => channel * foreground[3] / 255 + background[index] * (1 - foreground[3] / 255));
    const luminance = color => color.map(channel => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const selector = ['h1', 'h2', 'h3', '.page-intro p', '.page-eyebrow', '.login-subtitle',
      '.topbar-nav a', '.topbar-link', 'button:not(:disabled)', 'label', '.settings-check small',
      '.settings-note', '.section-heading > span', '.reading dt', '.reading dd',
      '.ai-metric dt', '.ai-metric dd', '.camera-ai-summary', '.detection-current'].join(',');
    const checked = [];
    const skipped = [];
    for (const element of document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!element.textContent.trim() || !box.width || !box.height || style.visibility === 'hidden') continue;
      const ancestors = [];
      for (let parent = element; parent; parent = parent.parentElement) ancestors.push(parent);
      // A CSS gradient or translucent subtree requires pixel sampling instead.
      // Report those separately rather than claiming this solid-surface check covers them.
      if (ancestors.some(parent => getComputedStyle(parent).backgroundImage !== 'none'
        || Number(getComputedStyle(parent).opacity) < 1)) {
        skipped.push(element.id || element.className || element.tagName);
        continue;
      }
      let background = [255, 255, 255];
      for (const parent of ancestors.reverse()) background = blend(rgba(getComputedStyle(parent).backgroundColor), background);
      const foreground = blend(rgba(style.color), background);
      const light = luminance(foreground), dark = luminance(background);
      const ratio = (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
      const font = parseFloat(style.fontSize);
      const large = font >= 24 || (font >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
      checked.push({ element: element.id || element.className || element.tagName,
        text: element.textContent.trim().slice(0, 60), ratio: Number(ratio.toFixed(2)),
        color: style.color, background: background.map(channel => Math.round(channel)),
        minimum: large ? 3 : 4.5, pass: ratio >= (large ? 3 : 4.5) - .01 });
    }
    return { checked, skipped, failures: checked.filter(item => !item.pass) };
  })()`);
}

async function checkPrimaryHovers() {
  const selector = '.settings-primary, .face-enroll-submit, .vision-buttons button:first-child, .login-form button, .command-buttons button';
  const count = await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const records = [];
  for (let index = 0; index < count; index++) {
    const target = await cdp.evaluate(`(() => {
      const button = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (button.disabled || button.closest('fieldset:disabled')) return null;
      button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const box = button.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2,
        element: button.id || button.className || button.tagName, text: button.textContent.trim().slice(0, 60) };
    })()`);
    if (!target) continue;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.ok(await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].matches(':hover')`),
      `Pointer must actually hover the enabled primary button: ${target.text}.`);
    const contrast = await inspectContrast();
    assert.deepEqual(contrast.failures, [], `Real primary-button hover contrast: ${target.text}.`);
    const sample = contrast.checked.find(item => item.element === target.element && item.text === target.text);
    assert.ok(sample, `The hovered primary-button foreground and surface must be sampled: ${target.text}.`);
    assert.ok(sample.pass, `The hovered primary-button label must have sufficient contrast: ${target.text}.`);
    records.push(sample);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await cdp.evaluate('window.scrollTo(0, 0)');
  assert.ok(records.length > 0, 'Each page must expose an enabled primary action for actual hover checks.');
  return records;
}

const screenshots = new Set(['1440-dark-metrics', '1440-light-metrics', '1440-dark-camera',
  '375-light-camera', '375-dark-settings', '320-light-login']);

try {
  backendServer = localFixtureApi().listen(0, '127.0.0.1');
  await new Promise((yes, no) => { backendServer.once('listening', yes); backendServer.once('error', no); });
  const backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
  frontend = await preview({ configFile: false, root: join(root, 'iot-frontend'),
    preview: { host: '127.0.0.1', port: await unusedPort(), strictPort: true,
      proxy: { '/api': { target: backendUrl, xfwd: true } } } });
  frontendUrl = `http://127.0.0.1:${frontend.httpServer.address().port}`;
  const devToolsPort = await unusedPort();
  let browserError;
  browserProcess = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    `--remote-debugging-port=${devToolsPort}`, `--user-data-dir=${join(temporary, 'browser-profile')}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  browserProcess.once('error', (error) => { browserError = error; });
  const collect = chunk => { browserOutput = (browserOutput + chunk.toString()).slice(-3000); };
  browserProcess.stdout.on('data', collect);
  browserProcess.stderr.on('data', collect);
  let target;
  await until(async () => {
    if (browserError) throw browserError;
    if (browserProcess.exitCode !== null) throw new Error(browserOutput);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json();
      target = targets.find(item => item.type === 'page');
      return Boolean(target);
    } catch { return false; }
  }, 'owned headless browser DevTools');
  await cdp.open(target.webSocketDebuggerUrl);
  let initScript;
  for (const width of [1440, 375, 320]) {
    for (const theme of ['dark', 'light']) {
      for (const page of ['metrics', 'camera', 'settings', 'login']) {
        activeCase = `${width}-${theme}-${page}`;
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width < 640 ? 900 : 1080,
          deviceScaleFactor: 1, mobile: width < 640 });
        await cdp.send('Emulation.setEmulatedMedia', { features: [
          { name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' },
        ] });
        if (initScript) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScript });
        initScript = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `localStorage.setItem('sentinel-theme', ${JSON.stringify(theme)})`,
        })).identifier;
        if (page === 'login') await cdp.send('Network.deleteCookies', { name: 'frontend-style-session', url: frontendUrl });
        else await cdp.send('Network.setCookie', { name: 'frontend-style-session', value: 'active', url: frontendUrl, httpOnly: true });
        // Release the previous fixture's long-lived proxy connections before a full
        // page navigation. This keeps the mock server from accumulating SSE sockets.
        for (const client of sseClients) client.end();
        await cdp.send('Page.stopLoading');
        await cdp.send('Page.navigate', { url: `${frontendUrl}/?style-fixture=${activeCase}#/${page === 'login' ? 'metrics' : page}` }, 20_000);
        const ready = {
          metrics: "document.querySelectorAll('.reading .chart svg').length === 4 && document.querySelector('.ai-panel')",
          camera: "document.querySelector('#face-enrollment-name') && !document.querySelector('.face-enrollment fieldset')?.disabled && document.querySelector('.face-catalog')?.innerText.includes('3 photo')",
          settings: "document.querySelector('.settings-form input[type=email]')?.value === 'operateur.sentinel-x@exemple.fr'",
          login: "document.querySelector('.login-form input[type=password]')",
        }[page];
        await until(() => cdp.evaluate(`Boolean(${ready})`), `${activeCase} content`);
        await cdp.evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
        const layout = await inspectLayout(page, width);
        assert.equal(layout.viewport, width, `${activeCase}: viewport must match the requested width.`);
        assert.ok(layout.overflow <= 1, `${activeCase}: horizontal document overflow: ${JSON.stringify(layout.overflowExamples)}`);
        assert.deepEqual(layout.badButtons, [], `${activeCase}: button target heights.`);
        assert.deepEqual(layout.badFields, [], `${activeCase}: text/file fields must remain visible and usable.`);
        assert.deepEqual(layout.badCheckboxTargets, [], `${activeCase}: mobile checkbox labels need 44px targets.`);
        assert.equal(layout.theme, theme, `${activeCase}: persisted theme must be applied before content.`);
        const contrast = await inspectContrast();
        assert.ok(contrast.checked.length >= 4, `${activeCase}: important text and button contrast must be sampled.`);
        assert.deepEqual(contrast.failures, [], `${activeCase}: computed text/button contrast on solid surfaces.`);
        if (page !== 'login') {
          assert.equal(layout.nav.length, 3, `${activeCase}: all page links must remain available.`);
          assert.ok(layout.nav.every(link => link.visible && link.withinViewport && link.tabIndex >= 0 && link.name
            && (width >= 640 || link.height >= 43.5)), `${activeCase}: navigation must remain visible and keyboard accessible.`);
          assert.equal(layout.nav.filter(link => link.current === 'page').length, 1);
          assert.equal(layout.nav.find(link => link.current === 'page').href, `#/${page}`);
        }
        if (page === 'metrics') await checkKeyboardNavigation();
        if (page === 'login') {
          assert.equal(layout.fieldCount, 2, `${activeCase}: both sign-in inputs must remain visible.`);
          await cdp.tab();
          assert.ok(await cdp.evaluate("document.activeElement?.matches(':focus-visible')"), `${activeCase}: sign-in keyboard focus must be visible.`);
          await cdp.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
        }
        if (width === 1440 && page === 'metrics' && theme === 'light') {
          await cdp.evaluate("document.querySelector('.topbar-theme').click()");
          await until(() => cdp.evaluate("document.documentElement.dataset.theme === 'dark' && localStorage.getItem('sentinel-theme') === 'dark'"), 'theme toggle to dark');
          await cdp.evaluate("document.querySelector('.topbar-theme').click()");
          await until(() => cdp.evaluate("document.documentElement.dataset.theme === 'light'"), 'theme toggle back to light');
        }
        const primaryHovers = await checkPrimaryHovers();
        assert.deepEqual(cdp.exceptions, [], `${activeCase}: uncaught browser JavaScript exceptions.`);
        report.cases.push({ case: activeCase, ...layout, contrast, primaryHovers });
        if (screenshots.has(activeCase)) {
          await cdp.evaluate('window.scrollTo(0, 0)');
          const metrics = await cdp.send('Page.getLayoutMetrics');
          const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height: Math.min(metrics.cssContentSize.height, 6000), scale: 1 } });
          const path = join(runtime, `${artifactPrefix}-${activeCase}.png`);
          writeFileSync(path, Buffer.from(capture.data, 'base64'));
          report.screenshots.push(relative(root, path));
        }
        console.log(`PASS ${activeCase}: no overflow; usable controls/navigation; ${contrast.checked.length} contrast checks; no JS exception.`);
      }
    }
  }
  assert.equal(report.cases.length, 24);
  assert.equal(report.screenshots.length, 6);
  assert.ok(requests.every(request => request.method === 'GET'), 'This check must never send a device/camera/mail mutation.');
  assert.ok(!requests.some(request => /\/camera\/stream|\/vision\/(?:start|stop|stream)$|\/api\/action/.test(request.path)),
    'No camera stream/start/stop or device command may be requested.');
  assert.ok(cdp.requests.filter(url => /^https?:/.test(url)).every(url => new URL(url).origin === frontendUrl),
    'Browser HTTP traffic must stay on the ephemeral frontend fixture origin.');
  console.log('PASS 24 responsive/theme cases; fixture server only; no application services or hardware accessed.');
  console.log('Screenshots:\n' + report.screenshots.join('\n'));
} catch (error) {
  report.failure = { case: activeCase, message: String(error) };
  console.error(error);
  if (cdp.socket?.readyState === WebSocket.OPEN) {
    console.error('Layout:', await inspectLayout(activeCase ?? 'startup', await cdp.evaluate('innerWidth')).catch(() => 'unavailable'));
    console.error('Recent fixture requests:', requests.slice(-15));
  }
  if (browserOutput) console.error('Owned browser output:\n' + browserOutput);
  process.exitCode = 1;
} finally {
  report.requests = requests;
  report.exceptions = cdp.exceptions;
  report.networkFailures = cdp.networkFailures;
  const reportPath = join(runtime, `${artifactPrefix}-report.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${relative(root, reportPath)}`);
  if (cdp.socket?.readyState === WebSocket.OPEN) await cdp.send('Browser.close', {}, 2000).catch(() => {});
  cdp.close();
  await terminate(browserProcess);
  for (const client of sseClients) client.end();
  if (frontend) {
    frontend.httpServer.closeAllConnections();
    await new Promise(yes => frontend.httpServer.close(yes));
  }
  if (backendServer) {
    backendServer.closeAllConnections();
    await new Promise(yes => backendServer.close(yes));
  }
  assertOwnedDirectory();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
