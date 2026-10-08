import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiGateway, AiPredictionRepository, LiveEvent } from './ports.js';
import type { AiPrediction, AiSensorSample, StoredAiPrediction } from '../domain/ai.js';
import { aiPrediction } from '../testing/ai-fixture.js';
import { faceResult } from '../testing/face-fixture.js';
import { AiCoordinator } from './ai-coordinator.js';

const now = new Date('2026-10-06T10:00:00Z');

test('reference reload cannot be undone by an older in-flight AI status', async () => {
  const { ai, gateway, published } = setup(async () => aiPrediction());
  await ai.refresh();
  let resolveStatus!: (value: Awaited<ReturnType<AiGateway['status']>>) => void;
  gateway.status = async () => new Promise((resolve) => { resolveStatus = resolve; });
  const waiting = ai.refresh();
  const faces = { ...faceResult(), timestamp: '2026-10-06T10:00:01.000Z', catalog_revision: 2 };
  gateway.reloadFaces = async () => faces;
  await ai.reloadFaces();
  resolveStatus({ status: 'online', model_loaded: true, vision: aiPrediction().vision, latest_prediction: null });
  await waiting;
  assert.equal(ai.getStatus().vision?.faces?.catalog_revision, 2);
  assert.ok(published.some((event) => event.type === 'ai-status' && event.status.vision?.faces?.known_identities === 1));
});

test('enrollment publishes its catalog and an older facial status cannot undo it', async () => {
  const { ai, gateway, published } = setup(async () => aiPrediction());
  await ai.refresh();
  let resolveFaces!: (faces: ReturnType<typeof faceResult>) => void;
  gateway.facesStatus = () => new Promise((resolve) => { resolveFaces = resolve; });
  const waiting = ai.getFacesStatus();
  const catalog = { ...faceResult(), catalog_revision: 2, timestamp: '2026-10-06T10:00:01.000Z' };
  gateway.enrollFaces = async (request) => ({ name: request.name, added: 0,
    rejected: [{ filename: request.images[0].filename, message: 'Aucun visage détecté.' }], catalog });
  const result = await ai.enrollFaces({ name: 'Mohamed', images: [{ filename: 'photo.jpg', content_base64: 'Zg==' }] });
  resolveFaces(faceResult());
  await waiting;
  assert.equal(result.added, 0);
  assert.equal(result.rejected[0].filename, 'photo.jpg');
  assert.equal(ai.getStatus().vision?.faces?.catalog_revision, 2);
  assert.ok(published.some((event) => event.type === 'ai-status' && event.status.vision?.faces?.catalog_revision === 2));
});

function setup(analyze: AiGateway['analyze'], limit = 32) {
  const published: LiveEvent[] = [];
  const stored: StoredAiPrediction[] = [];
  const repository: AiPredictionRepository = {
    save(prediction) { const value = { ...prediction, id: stored.length + 1 }; stored.unshift(value); return value; },
    findRecent: (count) => stored.slice(0, count), deleteOlderThan: () => 0,
  };
  const gateway: AiGateway = {
    isConfigured: () => true, analyze,
    status: async () => ({ status: 'online', model_loaded: true, vision: aiPrediction().vision, latest_prediction: null }),
    controlVision: async () => aiPrediction().vision,
  };
  const events = { publish: (event: LiveEvent) => published.push(event), subscribe: () => () => {} };
  let currentTime = now;
  const clock = { now: () => currentTime, advance: (ms: number) => { currentTime = new Date(+currentTime + ms); } };
  const ai = new AiCoordinator(gateway, repository, events, clock, limit);
  return { ai, gateway, stored, published, repository, events, clock };
}

async function idle(ai: AiCoordinator) {
  for (let attempt = 0; attempt < 20 && ai.getStatus().queue_depth; attempt++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(ai.getStatus().queue_depth, 0);
}

test('AI outage preserves telemetry processing and recovers without fabricated predictions', async () => {
  const { ai, gateway, stored } = setup(async () => { throw new Error('backend unavailable'); });
  assert.doesNotThrow(() => ai.enqueue({ id: 1, recordedAt: now, gas: 130 }));
  await idle(ai);
  assert.equal(ai.getStatus().online, false);
  assert.equal(ai.getStatus().last_error, 'backend unavailable');
  assert.equal(ai.getLatest(), null);
  assert.equal(stored.length, 0);
  gateway.analyze = async (sample) => aiPrediction(sample.sample_id);
  ai.enqueue({ id: 2, recordedAt: now, gas: 131 });
  await idle(ai);
  assert.equal(ai.getStatus().online, true);
  assert.equal(ai.getLatest()?.sample_id, 2);
});

test('bounded queue keeps sample order and drops oldest waiting samples', async () => {
  const calls: number[] = [];
  let complete!: (prediction: AiPrediction) => void;
  const { ai } = setup(async (sample: AiSensorSample) => {
    calls.push(sample.sample_id);
    if (sample.sample_id === 1) return new Promise((resolve) => { complete = resolve; });
    return aiPrediction(sample.sample_id, new Date(now.getTime() + sample.sample_id).toISOString());
  }, 2);
  for (let id = 1; id <= 4; id++) ai.enqueue({ id, recordedAt: now, temperature: 24 });
  assert.equal(ai.getStatus().queue_depth, 3);
  assert.equal(ai.getStatus().dropped_samples, 1);
  complete(aiPrediction());
  await idle(ai);
  assert.deepEqual(calls, [1, 3, 4]);
});

test('old replayed or out of order readings cannot become current AI alerts', async () => {
  let calls = 0;
  const { ai } = setup(async () => { calls++; return aiPrediction(); });
  ai.enqueue({ id: 1, recordedAt: new Date(now.getTime() - 60_000), presence: true });
  ai.enqueue({ id: 2, recordedAt: now, presence: false });
  ai.enqueue({ id: 3, recordedAt: new Date(now.getTime() - 1000), presence: true });
  await idle(ai);
  assert.equal(calls, 1);
});

test('health polling stores camera updates once and publishes AI SSE events', async () => {
  const { ai, gateway, stored, published } = setup(async () => aiPrediction());
  gateway.status = async () => ({ status: 'online', model_loaded: true,
    vision: aiPrediction().vision, latest_prediction: aiPrediction() });
  await ai.refresh();
  await ai.refresh();
  assert.equal(stored.length, 1);
  assert.equal(published.filter((event) => event.type === 'ai').length, 1);
  assert.equal(published.some((event) => event.type === 'ai-status'), true);
});

test('simulation source survives inference transport', async () => {
  let received: AiSensorSample | undefined;
  const { ai } = setup(async (sample) => { received = sample; return { ...aiPrediction(), source: sample.source }; });
  ai.enqueue({ id: 1, recordedAt: now, gas: 130 }, 'simulation');
  await idle(ai);
  assert.equal(received?.source, 'simulation');
  assert.equal(ai.getLatest()?.source, 'simulation');
});

test('sensor ordering is independent for live data and simulation', async () => {
  const calls: AiSensorSample[] = [];
  const { ai, stored } = setup(async (sample) => {
    calls.push(sample);
    return { ...aiPrediction(sample.sample_id, sample.timestamp), source: sample.source };
  });
  ai.enqueue({ id: 1, recordedAt: new Date(+now + 1_000), gas: 130, source: 'simulation' });
  ai.enqueue({ id: 2, recordedAt: now, gas: 38, source: 'live' });
  ai.enqueue({ id: 3, recordedAt: new Date(+now - 1_000), gas: 131, source: 'simulation' });
  ai.enqueue({ id: 4, recordedAt: new Date(+now - 1_000), gas: 39, source: 'live' });
  await idle(ai);
  assert.deepEqual(calls.map((sample) => [sample.sample_id, sample.source]), [[1, 'simulation'], [2, 'live']]);
  assert.equal(stored.length, 2);
  assert.equal(ai.getLatest()?.sample_id, 2);
  assert.equal(ai.getLatest()?.source, 'live');
});

test('future samples beyond five seconds cannot poison either source order', async () => {
  const calls: number[] = [];
  const { ai } = setup(async (sample) => {
    calls.push(sample.sample_id);
    return { ...aiPrediction(sample.sample_id, sample.timestamp), source: sample.source };
  });
  ai.enqueue({ id: 10, recordedAt: new Date(+now + 5_001), gas: 900, source: 'live' });
  ai.enqueue({ id: 11, recordedAt: new Date(+now + 5_001), gas: 901, source: 'simulation' });
  ai.enqueue({ id: 1, recordedAt: now, gas: 38, source: 'live' });
  ai.enqueue({ id: 2, recordedAt: new Date(+now + 5_000), gas: 120, source: 'simulation' });
  ai.enqueue({ id: 12, recordedAt: new Date(NaN), gas: 902, source: 'live' });
  await idle(ai);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(ai.getLatest()?.sample_id, 1);
});

test('simulation predictions preserve the canonical real-camera and facial status', async () => {
  const { ai, gateway } = setup(async (sample) => ({ ...aiPrediction(sample.sample_id, sample.timestamp), source: sample.source }));
  const vision = { ...aiPrediction().vision, status: 'running' as const, stream_ready: true,
    person_detected: true, person_count: 1, faces: faceResult() };
  gateway.status = async () => ({ status: 'online', model_loaded: true, vision, latest_prediction: null });
  await ai.refresh();
  ai.enqueue({ id: 1, recordedAt: now, presence: true, source: 'simulation' });
  await idle(ai);
  assert.deepEqual(ai.getStatus().vision, vision);
  assert.equal(ai.getLatest()?.source, 'simulation');
  assert.equal(ai.getLatest()?.vision.status, 'stopped');
});

test('simulation cannot initialize a fabricated camera state before health polling', async () => {
  const { ai, gateway } = setup(async (sample) => ({ ...aiPrediction(sample.sample_id, sample.timestamp), source: sample.source }));
  ai.enqueue({ id: 1, recordedAt: now, gas: 120, source: 'simulation' });
  await idle(ai);
  assert.equal(ai.getStatus().online, true);
  assert.equal(ai.getStatus().vision, null);
  const vision = { ...aiPrediction().vision, status: 'running' as const, stream_ready: true };
  gateway.status = async () => ({ status: 'online', model_loaded: true, vision, latest_prediction: null });
  await ai.refresh();
  assert.deepEqual(ai.getStatus().vision, vision);
});

test('fresh live results stay primary while simulations remain in history and SSE without duplicate polling', async () => {
  const { ai, gateway, stored, published } = setup(async (sample) => ({
    ...aiPrediction(sample.sample_id, sample.timestamp), source: sample.source,
  }));
  ai.enqueue({ id: 1, recordedAt: now, gas: 38, source: 'live' });
  ai.enqueue({ id: 2, recordedAt: new Date(+now + 1_000), gas: 120, source: 'simulation' });
  ai.enqueue({ id: 3, recordedAt: new Date(+now + 2_000), gas: 121, source: 'simulation' });
  await idle(ai);
  assert.equal(ai.getLatest()?.source, 'live');
  assert.equal(ai.getLatest()?.sample_id, 1);
  assert.equal(stored.length, 3);
  assert.deepEqual(published.filter((event) => event.type === 'ai').map((event) => event.prediction.source),
    ['live', 'simulation', 'simulation']);
  gateway.status = async () => ({ status: 'online', model_loaded: true,
    vision: aiPrediction().vision, latest_prediction: stored[1] });
  await ai.refresh();
  await ai.refresh();
  assert.equal(stored.length, 3);
  assert.equal(published.filter((event) => event.type === 'ai').length, 3);
  assert.equal(ai.getLatest()?.sample_id, 1);
});

test('live priority expires using the sensor timestamp despite more recent camera predictions', async () => {
  const { ai, gateway, clock } = setup(async (sample) => ({
    ...aiPrediction(sample.sample_id, new Date(Date.parse(sample.timestamp) + 1).toISOString()),
    sensor_timestamp: sample.timestamp, source: sample.source,
  }));
  ai.enqueue({ id: 1, recordedAt: now, gas: 38, source: 'live' });
  await idle(ai);
  clock.advance(20_000);
  const cameraUpdate = { ...aiPrediction(1, clock.now().toISOString()), sensor_timestamp: now.toISOString() };
  gateway.status = async () => ({ status: 'online', model_loaded: true,
    vision: cameraUpdate.vision, latest_prediction: cameraUpdate });
  await ai.refresh();
  ai.enqueue({ id: 2, recordedAt: clock.now(), gas: 120, source: 'simulation' });
  await idle(ai);
  assert.equal(ai.getLatest()?.source, 'live');
  clock.advance(10_001);
  assert.equal(ai.getLatest()?.source, 'simulation');
  assert.equal(ai.getLatest()?.sample_id, 2);
});

test('restoring history preserves fresh live priority even when a simulation was recorded last', async () => {
  const { ai, gateway, repository, events, clock, stored } = setup(async (sample) => ({
    ...aiPrediction(sample.sample_id, sample.timestamp), source: sample.source,
  }));
  ai.enqueue({ id: 1, recordedAt: now, gas: 38, source: 'live' });
  ai.enqueue({ id: 2, recordedAt: new Date(+now + 1_000), gas: 120, source: 'simulation' });
  await idle(ai);
  const restored = new AiCoordinator(gateway, repository, events, clock);
  assert.equal(restored.getLatest()?.sample_id, 1);
  gateway.status = async () => ({ status: 'online', model_loaded: true,
    vision: aiPrediction().vision, latest_prediction: stored[0] });
  await restored.refresh();
  assert.equal(stored.length, 2);
  assert.equal(restored.getLatest()?.sample_id, 1);
});

test('forwards only the four sensor features while keeping device flags out of the AI contract', async () => {
  let received: AiSensorSample | undefined;
  const { ai } = setup(async (sample) => { received = sample; return aiPrediction(sample.sample_id); });
  ai.enqueue({ id: 1, recordedAt: now, source: 'live', temperature: 24, humidity: 48,
    gas: 620, presence: true, climateValid: true, gasReady: true, pirReady: true,
    gasAlert: true, alarmActive: true, ledRed: true, ledOrange: false, ledGreen: false });
  await idle(ai);
  assert.deepEqual(received, { temperature: 24, humidity: 48, gas: 620, presence: true,
    sample_id: 1, timestamp: now.toISOString(), source: 'live' });
});

test('unready or invalid sensors are omitted from inference without fabricating zero values', async () => {
  const received: AiSensorSample[] = [];
  const { ai } = setup(async (sample) => { received.push(sample); return aiPrediction(sample.sample_id); });
  ai.enqueue({ id: 1, recordedAt: now, temperature: 0, humidity: 0, gas: 930, presence: true,
    climateValid: false, gasReady: false, pirReady: false, ledOrange: true });
  ai.enqueue({ id: 2, recordedAt: now, temperature: 24, humidity: 48, gas: 120, presence: false });
  await idle(ai);
  assert.deepEqual(received, [
    { sample_id: 1, timestamp: now.toISOString(), source: 'live' },
    { sample_id: 2, timestamp: now.toISOString(), source: 'live', temperature: 24, humidity: 48,
      gas: 120, presence: false },
  ]);
});

test('an old full status response cannot undo a webcam stop', async () => {
  const { ai, gateway } = setup(async () => aiPrediction());
  let complete!: (status: Awaited<ReturnType<AiGateway['status']>>) => void;
  gateway.status = () => new Promise((resolve) => { complete = resolve; });
  gateway.controlVision = async () => ({ ...aiPrediction().vision, status: 'stopped' });
  const polling = ai.refresh();
  await ai.controlVision('stop');
  complete({ status: 'online', model_loaded: true, vision: aiPrediction().vision, latest_prediction: null });
  await polling;
  assert.equal(ai.getStatus().vision?.status, 'stopped');
});
