import type { AiPrediction } from '../domain/ai.js';

export function aiPrediction(sampleId = 1, timestamp = '2026-10-06T10:00:00.000Z'): AiPrediction {
  return {
    sample_id: sampleId, sensor_timestamp: timestamp, timestamp, source: 'live',
    anomaly: { status: 'ready', is_anomaly: false, anomaly_score: 0.12, confidence: 0.88,
      reason: 'Within learned baseline', features: { temperature: 24 }, missing_fields: [], timestamp },
    vision: { status: 'stopped', error: null, person_detected: false, person_count: 0,
      max_confidence: 0, confirmed: false, objects: [], timestamp, fps: 0,
      inference_time_ms: 0, last_prediction_time: null },
    risk: { risk_score: 0, risk_level: 'SAFE', category: 'SAFE', reasons: [], confidence: 0.88,
      degraded: true, timestamp },
  };
}
