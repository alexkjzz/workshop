import type { FaceDetection, FaceRecognitionResult } from '../domain/faces.js';

export function faceDetection(): FaceDetection {
  return { face_id: 'face-test', name: 'Mohamed', known: true, confidence: .91, similarity: .91,
    detection_confidence: .99, recognizable: true, reason: null, bbox: [10, 20, 80, 100],
    timestamp: '2026-10-06T10:00:00.000Z', tracker_id: 7 };
}

export function faceResult(): FaceRecognitionResult {
  const face = faceDetection();
  return { enabled: true, status: 'running', model_loaded: true, known_identities: 1,
    reference_images: 3, skipped_images: 0, identities: ['Mohamed'], threshold: .55,
    faces: [face], history: [face], timestamp: face.timestamp, last_prediction_time: face.timestamp,
    loaded_at: face.timestamp, inference_time_ms: 25, error: null, reload_error: null, reloading: false, catalog_revision: 1 };
}
