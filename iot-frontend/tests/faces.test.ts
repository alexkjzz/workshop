import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiStatus } from '../src/domain/ai.ts';
import { currentFaces, faceRecognitionLabel, type FaceRecognitionResult } from '../src/domain/faces.ts';

const timestamp = '2026-10-06T10:00:00.000Z';
const now = Date.parse(timestamp);
const result: FaceRecognitionResult = {
  enabled: true, status: 'running', model_loaded: true, known_identities: 0, reference_images: 0,
  skipped_images: 0, identities: [], threshold: .55, faces: [], history: [], timestamp,
  last_prediction_time: timestamp, loaded_at: timestamp, inference_time_ms: 20, error: null,
  reload_error: null, reloading: false, catalog_revision: 1,
};
const status: AiStatus = {
  online: true, model_loaded: false, last_success_at: timestamp, last_error: null, queue_depth: 0, dropped_samples: 0,
  vision: { status: 'running', error: null, person_detected: true, person_count: 1, max_confidence: .9,
    confirmed: true, objects: [], timestamp, fps: 15, inference_time_ms: 35, last_prediction_time: timestamp,
    detection_status: 'running', faces: result },
};

test('a YOLO person without a visible face is explicitly not identifiable', () => {
  assert.equal(faceRecognitionLabel(status, result, now), 'Personne détectée, visage non identifiable');
  const empty = { ...status, vision: { ...status.vision!, person_count: 0 } };
  assert.equal(faceRecognitionLabel(empty, result, now), 'Aucun visage détecté actuellement');
  assert.equal(faceRecognitionLabel({ ...status, vision: { ...status.vision!, detection_status: 'unavailable' } }, result, now),
    'Aucun visage détecté actuellement');
});

test('recognized, unknown and multiple faces remain distinct from YOLO evidence', () => {
  const known = { face_id: 'one', name: 'Mohamed', known: true, confidence: .91, similarity: .91,
    detection_confidence: .99, recognizable: true, reason: null, bbox: [1, 2, 60, 90] as [number, number, number, number], timestamp, tracker_id: 7 };
  const unknown = { ...known, face_id: 'two', name: 'Unknown', known: false, confidence: .2, similarity: .2, tracker_id: null };
  const current = { ...result, faces: [known, unknown] };
  assert.deepEqual(currentFaces(current, now), [known, unknown]);
  assert.equal(faceRecognitionLabel(status, current, now), '2 visages détectés');
  assert.equal(faceRecognitionLabel(status, { ...result, faces: [unknown] }, now), '1 visage détecté');
});

test('offline, stopped, stale, missing models, reload and disabled have honest states', () => {
  assert.match(faceRecognitionLabel(null, null, now), /Connexion/);
  assert.match(faceRecognitionLabel({ ...status, online: false }, result, now), /hors ligne/);
  assert.match(faceRecognitionLabel({ ...status, vision: null }, null, now), /En attente/);
  assert.match(faceRecognitionLabel(status, { ...result, enabled: false }, now), /désactivée/);
  assert.match(faceRecognitionLabel(status, { ...result, status: 'loading', model_loaded: false }, now), /Chargement/);
  assert.match(faceRecognitionLabel(status, { ...result, status: 'unavailable', model_loaded: false }, now), /Modèle facial indisponible/);
  assert.match(faceRecognitionLabel({ ...status, vision: { ...status.vision!, status: 'stopped' } }, result, now), /Caméra arrêtée/);
  assert.match(faceRecognitionLabel(status, { ...result, reloading: true }, now), /Rechargement/);
  assert.match(faceRecognitionLabel(status, { ...result, status: 'error' }, now), /indisponible/);
  assert.equal(currentFaces(result, now + 5000), null);
  assert.equal(currentFaces(result, now - 1), null);
  assert.match(faceRecognitionLabel(status, result, now + 5000), /analyse faciale récente/);
});

test('a legacy running AI service without facial metadata needs a restart, not endless waiting', () => {
  const legacy = { ...status, vision: { ...status.vision!, faces: undefined } };
  const label = faceRecognitionLabel(legacy, legacy.vision.faces, now);
  assert.match(label, /Service facial non chargé/);
  assert.match(label, /Redémarrez le service IA et le backend/);
  assert.doesNotMatch(label, /En attente/);
});
