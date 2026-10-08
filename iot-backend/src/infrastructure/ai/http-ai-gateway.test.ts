import assert from 'node:assert/strict';
import test from 'node:test';
import { aiPrediction } from '../../testing/ai-fixture.js';
import { HttpAiGateway } from './http-ai-gateway.js';

test('uses the agreed AI JSON contract, timeout and optional service token', async (context) => {
  let requestedUrl = '';
  let options: RequestInit | undefined;
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requestedUrl = url; options = init;
    return Response.json(aiPrediction());
  });
  const gateway = new HttpAiGateway('http://127.0.0.1:8000/', 100, 'test-token');
  const sample = { temperature: 24, timestamp: aiPrediction().timestamp, sample_id: 1, source: 'live' as const };
  assert.equal((await gateway.analyze(sample)).anomaly.is_anomaly, false);
  assert.equal(requestedUrl, 'http://127.0.0.1:8000/analyze');
  assert.deepEqual(JSON.parse(options?.body as string), sample);
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-token');
  assert.ok(options?.signal instanceof AbortSignal);
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requestedUrl = url; options = init;
    return Response.json(aiPrediction().vision);
  });
  assert.equal((await gateway.visionStatus()).status, 'stopped');
  assert.equal(requestedUrl, 'http://127.0.0.1:8000/vision/status');
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-token');
});

test('rejects malformed AI results and converts network failures into useful errors', async (context) => {
  const mocked = context.mock.method(globalThis, 'fetch', async () => Response.json({ risk: { risk_score: 999 } }));
  const gateway = new HttpAiGateway('http://127.0.0.1:8000');
  const sample = { timestamp: aiPrediction().timestamp, sample_id: 1, source: 'live' as const };
  await assert.rejects(gateway.analyze(sample), /invalid prediction/);
  mocked.mock.mockImplementation(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(gateway.status(), /unreachable/);
  mocked.mock.mockImplementation(async () => { throw new DOMException('timeout', 'TimeoutError'); });
  await assert.rejects(gateway.status(), /timed out/);
});
