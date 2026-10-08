import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { AiCoordinator } from '../../../application/ai-coordinator.js';
import { FaceEnrollmentError } from '../../../application/errors.js';
import type { FaceEnrollmentRequest } from '../../../domain/faces.js';
import { SqliteAiRepository } from '../../../infrastructure/persistence/sqlite-ai-repository.js';
import { InMemoryLiveEvents } from '../../../infrastructure/events/in-memory-live-events.js';
import { aiPrediction } from '../../../testing/ai-fixture.js';
import { faceResult } from '../../../testing/face-fixture.js';
import { createHttpApp, type HttpDependencies } from '../app.js';

async function withEnrollmentServer(run: (url: string, ai: AiCoordinator, submitted: FaceEnrollmentRequest[],
  setFailure: (status: 400 | 413 | 422 | 503 | null) => void) => Promise<void>) {
  const repository = new SqliteAiRepository(':memory:');
  const liveEvents = new InMemoryLiveEvents();
  const submitted: FaceEnrollmentRequest[] = [];
  let failure: 400 | 413 | 422 | 503 | null = null;
  const ai = new AiCoordinator({
    isConfigured: () => true, analyze: async () => aiPrediction(), controlVision: async () => aiPrediction().vision,
    status: async () => ({ status: 'online', model_loaded: true,
      vision: { ...aiPrediction().vision, faces: faceResult() }, latest_prediction: null }),
    enrollFaces: async (request) => {
      submitted.push(request);
      if (failure !== null) throw new FaceEnrollmentError('Corrigez les photos ou chargez le modèle facial.', failure);
      return { name: request.name, added: request.images.length, rejected: [],
        catalog: { ...faceResult(), catalog_revision: 2 } };
    },
  }, repository, liveEvents, { now: () => new Date() });
  const app = createHttpApp({
    useCases: {} as HttpDependencies['useCases'], liveEvents, ai,
    cameraFeed: { isConfigured: () => false, open: async () => null },
    sessions: { verify: async (headers) => headers.get('cookie') === 'test=session'
      ? { userName: 'Test', userEmail: 'test@localhost', expiresAt: new Date(Date.now() + 60_000) } : null },
    authHandler: async (request, response) => {
      let bytes = 0;
      for await (const chunk of request) bytes += chunk.length;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ bytes }));
    },
    frontendOrigins: [], trustProxy: 'loopback',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, ai, submitted, (status) => { failure = status; });
  } finally {
    ai.stop(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repository.close();
  }
}

const post = (body: string, authenticated = true): RequestInit => ({ method: 'POST', body,
  headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: 'test=session' } : {}) } });
const body = (content = 'Zg==') => JSON.stringify({ name: ' Mohamed ', images: [{ filename: 'photo.jpg', content_base64: content }] });

test('enrollment authenticates before parsing photos and preserves Better Auth raw bodies', async () => {
  await withEnrollmentServer(async (url, _ai, submitted) => {
    const malformedLargeBody = 'x'.repeat(32 * 1024);
    assert.equal((await fetch(`${url}/api/ai/vision/faces/enroll`, post(malformedLargeBody, false))).status, 401);
    assert.equal(submitted.length, 0);
    const auth = await fetch(`${url}/api/auth/test`, post(malformedLargeBody, false));
    assert.equal(auth.status, 200);
    assert.deepEqual(await auth.json(), { bytes: malformedLargeBody.length });
  });
});

test('authenticated enrollment accepts photos above 16kb and updates the canonical facial catalog', async () => {
  await withEnrollmentServer(async (url, ai, submitted) => {
    await ai.refresh();
    const content = Buffer.alloc(20 * 1024).toString('base64');
    const response = await fetch(`${url}/api/ai/vision/faces/enroll`, post(body(content)));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).catalog.catalog_revision, 2);
    assert.deepEqual(submitted, [{ name: 'Mohamed', images: [{ filename: 'photo.jpg', content_base64: content }] }]);
    assert.equal(ai.getStatus().vision?.faces?.catalog_revision, 2);
    const regular = await fetch(`${url}/api/ai/vision/faces/reload`, post(body(content)));
    assert.equal(regular.status, 413);
    assert.deepEqual(await regular.json(), { message: 'Request body exceeds the allowed size.' });
  });
});

test('enrollment rejects invalid JSON, invalid names, too many images and bodies above 21MiB', async () => {
  await withEnrollmentServer(async (url, _ai, submitted) => {
    for (const payload of ['{bad', JSON.stringify({ name: '../A', images: [] }),
      JSON.stringify({ name: 'A', images: Array(6).fill({ filename: 'photo.jpg', content_base64: 'Zg==' }) })]) {
      const response = await fetch(`${url}/api/ai/vision/faces/enroll`, post(payload));
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).message, 'string');
    }
    const oversized = await fetch(`${url}/api/ai/vision/faces/enroll`, post('x'.repeat(21 * 1024 * 1024 + 1)));
    assert.equal(oversized.status, 413);
    assert.equal(submitted.length, 0);
  });
});

test('enrollment exposes safe actionable validation and model errors with the upstream HTTP status', async () => {
  await withEnrollmentServer(async (url, _ai, _submitted, setFailure) => {
    for (const status of [400, 413, 422, 503] as const) {
      setFailure(status);
      const response = await fetch(`${url}/api/ai/vision/faces/enroll`, post(body()));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { message: 'Corrigez les photos ou chargez le modèle facial.' });
    }
  });
});
