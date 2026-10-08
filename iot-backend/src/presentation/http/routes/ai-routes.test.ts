import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { AiCoordinator } from '../../../application/ai-coordinator.js';
import { SqliteAiRepository } from '../../../infrastructure/persistence/sqlite-ai-repository.js';
import { InMemoryLiveEvents } from '../../../infrastructure/events/in-memory-live-events.js';
import { aiPrediction } from '../../../testing/ai-fixture.js';
import { faceResult } from '../../../testing/face-fixture.js';
import { createHttpApp, type HttpDependencies } from '../app.js';

test('AI endpoints keep session protection and return safe outage responses', async () => {
  const repository = new SqliteAiRepository(':memory:');
  const liveEvents = new InMemoryLiveEvents();
  const ai = new AiCoordinator({
    isConfigured: () => true, analyze: async () => aiPrediction(),
    status: async () => { throw new Error('AI service is unreachable.'); },
    controlVision: async () => { throw new Error('AI service is unreachable.'); },
  }, repository, liveEvents, { now: () => new Date() });
  const app = createHttpApp({
    useCases: {} as HttpDependencies['useCases'], liveEvents, ai,
    cameraFeed: { isConfigured: () => false, open: async () => null },
    sessions: { verify: async (headers) => headers.get('cookie') === 'test=session' ? {
      userName: 'Test', userEmail: 'test@localhost', expiresAt: new Date(Date.now() + 60_000),
    } : null },
    authHandler: (_request, response) => response.end(), frontendOrigins: [], trustProxy: 'loopback',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const options = { headers: { Cookie: 'test=session' } };
  try {
    assert.equal((await fetch(`${url}/api/ai/status`)).status, 401);
    assert.equal((await fetch(`${url}/api/ai/vision/start`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${url}/api/ai/vision/status`)).status, 401);
    assert.equal((await fetch(`${url}/api/ai/vision/stream`)).status, 401);
    for (const path of ['status', 'latest', 'history', 'reload']) {
      const method = path === 'reload' ? 'POST' : 'GET';
      assert.equal((await fetch(`${url}/api/ai/vision/faces/${path}`, { method })).status, 401);
      assert.equal((await fetch(`${url}/api/ai/vision/faces/${path}`, { ...options, method })).status, 503);
    }
    const status = await fetch(`${url}/api/ai/status`, options);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).online, false);
    assert.equal(await (await fetch(`${url}/api/ai/latest`, options)).json(), null);
    assert.deepEqual(await (await fetch(`${url}/api/ai/history`, options)).json(), { predictions: [] });
    assert.equal((await fetch(`${url}/api/ai/history?limit=501`, options)).status, 400);
    assert.equal((await fetch(`${url}/api/ai/vision/start`, { ...options, method: 'POST' })).status, 503);
    assert.equal((await fetch(`${url}/api/ai/vision/status`, options)).status, 503);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  } finally {
    ai.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repository.close();
  }
});

test('authenticated face routes return recognition, history and reload without exposing Python to the browser', async () => {
  const repository = new SqliteAiRepository(':memory:');
  const liveEvents = new InMemoryLiveEvents();
  const faces = faceResult();
  let reloads = 0;
  const ai = new AiCoordinator({
    isConfigured: () => true, analyze: async () => aiPrediction(), controlVision: async () => aiPrediction().vision,
    status: async () => ({ status: 'online', model_loaded: true, vision: { ...aiPrediction().vision, faces }, latest_prediction: null }),
    facesStatus: async () => faces,
    facesLatest: async () => ({ faces: faces.faces, timestamp: faces.timestamp, status: faces.status }),
    facesHistory: async () => ({ faces: faces.history }),
    reloadFaces: async () => { reloads++; return { ...faces, catalog_revision: reloads + 1 }; },
  }, repository, liveEvents, { now: () => new Date() });
  const app = createHttpApp({
    useCases: {} as HttpDependencies['useCases'], liveEvents, ai,
    cameraFeed: { isConfigured: () => false, open: async () => null },
    sessions: { verify: async (headers) => headers.get('cookie') === 'test=session'
      ? { userName: 'Test', userEmail: 'test@localhost', expiresAt: new Date(Date.now() + 60_000) } : null },
    authHandler: (_request, response) => response.end(), frontendOrigins: [], trustProxy: 'loopback',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai/vision/faces`;
  const options = { headers: { Cookie: 'test=session' } };
  try {
    await ai.refresh();
    assert.equal((await (await fetch(`${url}/status`, options)).json()).known_identities, 1);
    assert.equal((await (await fetch(`${url}/latest`, options)).json()).faces[0].tracker_id, 7);
    assert.equal((await (await fetch(`${url}/history`, options)).json()).faces[0].name, 'Mohamed');
    assert.equal((await (await fetch(`${url}/reload`, { ...options, method: 'POST' })).json()).catalog_revision, 2);
    assert.equal(reloads, 1);
    assert.equal(ai.getStatus().vision?.faces?.catalog_revision, 2);
  } finally {
    ai.stop(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repository.close();
  }
});
