import assert from 'node:assert/strict';
import test from 'node:test';
import { faceResult } from '../../testing/face-fixture.js';
import { aiPrediction } from '../../testing/ai-fixture.js';
import { parseAiVision, parseFaceHistory, parseFaceLatest, parseFaces } from './ai-contract.js';
import { HttpAiGateway } from './http-ai-gateway.js';

test('face contracts separate recognition, tracking and person detection', () => {
  const faces = faceResult();
  assert.equal(parseFaces(faces).faces[0]?.tracker_id, 7);
  assert.equal(parseAiVision({ ...aiPrediction().vision, faces }).faces?.faces[0]?.name, 'Mohamed');
  assert.equal(parseFaceLatest({ faces: faces.faces, timestamp: faces.timestamp, status: 'running' }).faces.length, 1);
  assert.equal(parseFaceHistory({ faces: faces.history }).faces.length, 1);
  for (const invalid of [
    { ...faces, known_identities: 2 }, { ...faces, history: Array(21).fill(faces.faces[0]) },
    { ...faces, threshold: 2 }, { ...faces, faces: [{ ...faces.faces[0], known: false }] },
    { ...faces, faces: [{ ...faces.faces[0], confidence: 2 }] },
    { ...faces, faces: [{ ...faces.faces[0], timestamp: 'bad' }] },
  ]) assert.throws(() => parseFaces(invalid), /invalid/);
  const unknown = { ...faces.faces[0]!, known: false, name: 'Unknown', confidence: .3, similarity: .3, tracker_id: null };
  assert.equal(parseFaces({ ...faces, faces: [unknown] }).faces[0]?.known, false);
  assert.throws(() => parseAiVision({ ...aiPrediction().vision, faces: { ...faces, status: 'bad' } }), /invalid/);
});

test('all facial gateway methods use the protected FastAPI paths and bearer token', async (context) => {
  const requested: { url: string; method: string; token: string | null }[] = [];
  const faces = faceResult();
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requested.push({ url, method: init.method!, token: new Headers(init.headers).get('authorization') });
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(url.endsWith('/latest') ? { faces: faces.faces, timestamp: faces.timestamp, status: faces.status }
      : url.endsWith('/history') ? { faces: faces.history } : faces);
  });
  const gateway = new HttpAiGateway('http://127.0.0.1:8001', 5000, 'face-token');
  assert.equal((await gateway.facesStatus()).known_identities, 1);
  assert.equal((await gateway.facesLatest()).faces[0]?.name, 'Mohamed');
  assert.equal((await gateway.facesHistory()).faces.length, 1);
  assert.equal((await gateway.reloadFaces()).catalog_revision, 1);
  assert.deepEqual(requested, ['status', 'latest', 'history', 'reload'].map((path) => ({
    url: `http://127.0.0.1:8001/vision/faces/${path}`, method: path === 'reload' ? 'POST' : 'GET', token: 'Bearer face-token',
  })));
});

test('an old Python service returning facial 404 gives an actionable restart message', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Not Found' }, { status: 404 }));
  const gateway = new HttpAiGateway('http://127.0.0.1:8001');
  for (const request of [() => gateway.facesStatus(), () => gateway.facesLatest(), () => gateway.facesHistory(), () => gateway.reloadFaces()]) {
    await assert.rejects(request(), /Redémarrez le service IA/);
  }
  await assert.rejects(gateway.visionStatus(), /HTTP 404/);
});
