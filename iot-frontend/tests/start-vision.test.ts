import assert from 'node:assert/strict';
import test from 'node:test';
import { startVisionAndWait } from '../src/application/start-vision.ts';
import type { AiVisionResult } from '../src/domain/ai.ts';

const vision = (status: AiVisionResult['status'], stream_ready = false): AiVisionResult => ({
  status, stream_ready, error: null, person_detected: false, person_count: 0,
  max_confidence: 0, confirmed: false, objects: [], timestamp: new Date().toISOString(),
  fps: 0, inference_time_ms: 0, last_prediction_time: null,
});

test('starting response is polled through Express until running and a frame is ready', async () => {
  const states: string[] = [];
  const calls: string[] = [];
  const replies = [vision('running', false), vision('running', true)];
  const result = await startVisionAndWait({
    startVision: async () => { calls.push('start'); return vision('starting'); },
    getVisionStatus: async () => { calls.push('status'); return replies.shift()!; },
  }, { intervalMs: 1, onState: (state) => states.push(`${state.status}:${state.stream_ready}`) });
  assert.equal(result.stream_ready, true);
  assert.deepEqual(calls, ['start', 'status', 'status']);
  assert.deepEqual(states, ['starting:false', 'running:false', 'running:true']);
});

test('retrying an already running camera does not wait or open a second device', async () => {
  let polls = 0;
  const result = await startVisionAndWait({ startVision: async () => vision('running', true),
    getVisionStatus: async () => { polls++; return vision('running', true); } });
  assert.equal(result.status, 'running');
  assert.equal(polls, 0);
});

test('camera errors are displayed instead of accepting an HTTP 200 as readiness', async () => {
  const result = { ...vision('unavailable'), error: 'Webcam occupée. Fermez Teams.' };
  await assert.rejects(startVisionAndWait({ startVision: async () => result,
    getVisionStatus: async () => result }), /Fermez Teams/);
});

test('stopping cancels startup polling and a stalled start times out', async () => {
  const cancel = new AbortController();
  let polls = 0;
  const api = { startVision: async () => vision('starting'),
    getVisionStatus: async () => { polls++; return vision('starting'); } };
  const operation = startVisionAndWait(api, { signal: cancel.signal, intervalMs: 1000 });
  cancel.abort();
  await assert.rejects(operation, (error: Error) => error.name === 'AbortError');
  assert.equal(polls, 0);
  await assert.rejects(startVisionAndWait(api, { timeoutMs: 10, intervalMs: 1 }), /trop de temps/);
});
