import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_HISTORY_SIZE,
  anomalyLabel,
  currentAiPrediction,
  currentAiVision,
  mergeAiPredictions,
  personDetectionHistory,
  personDetectionLabel,
  predictionEvents,
  riskLabel,
  type AiPrediction,
  type AiStatus,
} from '../src/domain/ai.ts';

function prediction(id = 1, timestamp = '2026-10-06T10:00:00.000Z'): AiPrediction {
  return {
    id,
    sample_id: id,
    sensor_timestamp: timestamp,
    source: 'live',
    timestamp,
    anomaly: {
      status: 'ready', is_anomaly: false, anomaly_score: 0.12, confidence: 0.85,
      reason: 'Normal sensor evolution', features: { presence: 0 }, missing_fields: [], timestamp,
    },
    vision: {
      status: 'running', error: null, person_detected: false, person_count: 0, max_confidence: 0,
      confirmed: false, objects: [], timestamp, fps: 12, inference_time_ms: 45, last_prediction_time: timestamp,
    },
    risk: {
      risk_score: 5, risk_level: 'SAFE', category: 'SAFE', reasons: [], confidence: 0.8, degraded: false, timestamp,
    },
  };
}

test('AI histories merge REST and SSE without duplicates, newest first and bounded', () => {
  const first = prediction(1);
  const second = prediction(2, '2026-10-06T10:00:02.000Z');
  assert.deepEqual(mergeAiPredictions([first], [second, first]).map((row) => row.id), [2, 1]);
  assert.deepEqual(mergeAiPredictions([prediction(3)], [first]).map((row) => row.id), [3, 1]);
  const many = Array.from({ length: AI_HISTORY_SIZE + 5 }, (_, i) => prediction(i, new Date(i * 1000).toISOString()));
  const merged = mergeAiPredictions([], many);
  assert.equal(merged.length, AI_HISTORY_SIZE);
  assert.equal(merged[0].id, AI_HISTORY_SIZE + 4);
  assert.equal(merged.at(-1)?.id, 5);
  assert.deepEqual(
    mergeAiPredictions([], [prediction(1, '2026-10-06T12:00:00+02:00'), prediction(2, '2026-10-06T10:00:01Z')]).map((row) => row.id),
    [2, 1],
  );
});

test('untrained, missing and failed anomaly analyses never display NORMAL', () => {
  const anomaly = prediction().anomaly;
  assert.equal(anomalyLabel(anomaly), 'NORMAL');
  assert.equal(anomalyLabel({ ...anomaly, is_anomaly: true }), 'ANOMALY');
  for (const status of ['untrained', 'insufficient_data', 'error'] as const) {
    assert.notEqual(anomalyLabel({ ...anomaly, status, is_anomaly: null }), 'NORMAL');
  }
  assert.equal(anomalyLabel({ ...anomaly, is_anomaly: null }), 'En attente');
  assert.equal(anomalyLabel(null), 'En attente');
});

test('recent physical analysis remains primary while demo results stay in history', () => {
  const live = prediction(1);
  const demo = { ...prediction(2, '2026-10-06T10:00:02Z'), source: 'simulation' as const };
  const now = Date.parse(demo.timestamp);
  const history = mergeAiPredictions([live], [demo]);
  assert.deepEqual(history.map(({ id }) => id), [2, 1]);
  assert.equal(currentAiPrediction(history, now), live);
  assert.equal(currentAiPrediction(history, Date.parse(live.sensor_timestamp!) + 30_001), demo);
  assert.equal(currentAiPrediction([demo], now), demo);
  assert.equal(currentAiPrediction([], now), undefined);
});

test('a refreshed analysis cannot make stale or far-future sensor data current', () => {
  const demo = { ...prediction(2, '2026-10-06T10:01:00Z'), source: 'simulation' as const };
  const now = Date.parse(demo.timestamp);
  const stale = { ...prediction(1), timestamp: demo.timestamp };
  assert.equal(currentAiPrediction([demo, stale], now), demo);
  const future = prediction(3, new Date(now + 5001).toISOString());
  assert.equal(currentAiPrediction([demo, future], now), demo);
  assert.equal(currentAiPrediction([demo, { ...future, sensor_timestamp: 'invalid' }], now), demo);
});

test('incomplete risk data cannot reassure the operator with SAFE', () => {
  const risk = prediction().risk;
  assert.equal(riskLabel(risk), 'SAFE');
  assert.equal(riskLabel({ ...risk, degraded: true }), 'INDÉTERMINÉ');
  assert.equal(riskLabel({ ...risk, degraded: true, risk_level: 'HIGH' }), 'HIGH · partiel');
  assert.equal(riskLabel(null), 'En attente');
});

test('stopped, stale, and invalid vision snapshots cannot describe current presence', () => {
  const vision = prediction().vision;
  const now = Date.parse(vision.timestamp);
  assert.equal(currentAiVision(vision, now + 2000), vision);
  assert.equal(currentAiVision(vision, now + 6000), null);
  assert.equal(currentAiVision({ ...vision, status: 'stopped' }, now), null);
  assert.equal(currentAiVision({ ...vision, last_prediction_time: null }, now), null);
  assert.equal(currentAiVision({ ...vision, last_prediction_time: 'invalid' }, now), null);
});

test('a single unconfirmed frame is absent from confirmed intrusion events', () => {
  const value = prediction();
  value.vision.person_detected = true;
  value.vision.person_count = 1;
  value.anomaly.features.presence = 1;
  assert.deepEqual(predictionEvents(value), ['NORMAL']);
  value.vision.confirmed = true;
  assert.deepEqual(predictionEvents(value), ['PERSON DETECTED', 'PIR CONFIRMED']);
  value.anomaly.is_anomaly = true;
  value.risk.risk_level = 'HIGH';
  assert.deepEqual(predictionEvents(value), ['PERSON DETECTED', 'PIR CONFIRMED', 'SENSOR ANOMALY', 'RISK HIGH']);
  value.vision.status = 'stopped';
  assert.deepEqual(predictionEvents(value), ['SENSOR ANOMALY', 'RISK HIGH']);
});

test('person detection distinguishes absent data from a successful analysis with zero people', () => {
  const value = prediction();
  const now = Date.parse(value.timestamp);
  const status: AiStatus = { online: true, model_loaded: true, vision: value.vision,
    last_success_at: value.timestamp, last_error: null, queue_depth: 0, dropped_samples: 0 };
  assert.match(personDetectionLabel(status, now), /Aucune personne détectée/);
  value.vision.person_count = 1;
  value.vision.person_detected = true;
  value.vision.confirmed = true;
  assert.match(personDetectionLabel(status, now), /1 personne détectée · présence confirmée/);
  for (const vision of [null, { ...value.vision, status: 'stopped' as const },
    { ...value.vision, detection_status: 'loading' as const },
    { ...value.vision, detection_status: 'unavailable' as const },
    { ...value.vision, last_prediction_time: null }]) {
    assert.doesNotMatch(personDetectionLabel({ ...status, vision }, now), /Aucune personne détectée/);
  }
  assert.doesNotMatch(personDetectionLabel({ ...status, online: false }, now), /Aucune personne détectée/);
  assert.doesNotMatch(personDetectionLabel(status, now + 6000), /1 personne détectée/);
});

test('camera history uses real inference timestamps and deduplicates sensor and status copies', () => {
  const first = prediction();
  const newer = prediction(2, '2026-10-06T10:00:02Z');
  newer.vision.person_count = 1;
  newer.vision.person_detected = true;
  newer.vision.confirmed = true;
  const copy = prediction(3, '2026-10-06T10:00:03Z');
  copy.vision = { ...newer.vision, last_prediction_time: '2026-10-06T12:00:02+02:00' };
  const rows = personDetectionHistory([first, newer, copy,
    { ...copy, vision: { ...copy.vision, status: 'stopped' } },
    { ...copy, vision: { ...copy.vision, detection_status: 'error' } },
    { ...copy, vision: { ...copy.vision, last_prediction_time: null } },
    { ...copy, vision: { ...copy.vision, last_prediction_time: 'invalid' } }]);
  assert.deepEqual(rows.map((vision) => vision.person_count), [1, 0]);
  assert.equal(rows[0].confirmed, true);
});
