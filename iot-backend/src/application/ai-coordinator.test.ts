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
  const ai = new AiCoordinator(gateway, repository, events, { now: () => now }, limit);
  return { ai, gateway, stored, published };
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
