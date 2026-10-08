#!/usr/bin/env node
// Renders docs/pdf-src/*.html to docs/pdf/*.pdf with a headless Chromium browser.
// Usage: node scripts/build-docs-pdf.mjs [--only firmware-technique]
// DOCS_BROWSER overrides the browser executable (Chrome, Edge or Chromium).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'docs', 'pdf-src');
const outputDir = join(root, 'docs', 'pdf');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const candidates = [
  process.env.DOCS_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find((path) => existsSync(path));
if (!browser) {
  console.error('Chrome, Edge ou Chromium introuvable : definir DOCS_BROWSER.');
  process.exit(1);
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function connect(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Browser still starting.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Le navigateur ne repond pas.');
}

const profile = mkdtempSync(join(tmpdir(), 'sentinel-docs-'));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

try {
  const ws = new WebSocket(await connect(port));
  await new Promise((r, reject) => { ws.addEventListener('open', r); ws.addEventListener('error', reject); });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (message) => {
    const data = JSON.parse(message.data);
    if (data.id) pending.get(data.id)?.(data);
    else events.push(data);
  });
  const send = (method, params = {}) => new Promise((r, reject) => {
    pending.set(++id, (data) => (data.error ? reject(new Error(`${method}: ${data.error.message}`)) : r(data.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');

  mkdirSync(outputDir, { recursive: true });
  const sources = readdirSync(sourceDir).filter((file) => file.endsWith('.html') && (!only || file === `${only}.html`)).sort();
  for (const file of sources) {
    const html = readFileSync(join(sourceDir, file), 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? file;
    const pdfName = html.match(/<meta name="pdf-name" content="([^"]+)"/)?.[1] ?? file.replace(/\.html$/, '.pdf');
    events.length = 0;
    await send('Page.navigate', { url: pathToFileURL(join(sourceDir, file)).href });
    for (let i = 0; i < 80 && !events.some((e) => e.method === 'Page.loadEventFired'); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 400));
    const footer = `<div style="width:100%;padding:0 17mm;font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:#8a93a3;display:flex;justify-content:space-between">
      <span>${escapeHtml(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
    const { data } = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer,
      generateDocumentOutline: true,
    });
    writeFileSync(join(outputDir, pdfName), Buffer.from(data, 'base64'));
    console.log(`docs/pdf/${pdfName}`);
  }
  ws.close();
} finally {
  // The browser keeps writing its profile until it has exited.
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
