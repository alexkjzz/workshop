// JSON contract shared with the local Python service. Unknown results remain null.
import type { FaceRecognitionResult } from './faces.js';
export type AiSource = 'live' | 'simulation';

export interface AiSensorSample {
  temperature?: number;
  humidity?: number;
  gas?: number;
  presence?: boolean;
  timestamp: string;
  sample_id: number;
  source: AiSource;
}

export interface AnomalyResult {
  status: 'ready' | 'untrained' | 'insufficient_data' | 'error';
  is_anomaly: boolean | null;
  anomaly_score: number | null;
  confidence: number | null;
  reason: string;
  features: Record<string, number>;
  missing_fields: string[];
  timestamp: string;
}

export interface VisionResult {
  status: 'stopped' | 'starting' | 'running' | 'unavailable' | 'error';
  error: string | null;
  person_detected: boolean;
  person_count: number;
  max_confidence: number;
  confirmed: boolean;
  objects: Array<{
    class: 'person';
    confidence: number;
    bbox: [number, number, number, number];
    track_id?: number | null;
  }>;
  timestamp: string;
  fps: number;
  inference_time_ms: number;
  last_prediction_time: string | null;
  stream_ready?: boolean;
  camera_index?: number | null;
  last_frame_time?: string | null;
  detection_status?: 'loading' | 'running' | 'unavailable' | 'error' | 'stopped' | null;
  detection_error?: string | null;
  faces?: FaceRecognitionResult | null;
}

export interface RiskResult {
  risk_score: number;
  risk_level: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: 'SAFE' | 'INTRUSION' | 'ENVIRONMENT' | 'MULTI_THREAT' | 'SENSOR_ANOMALY';
  reasons: string[];
  confidence: number;
  degraded: boolean;
  timestamp: string;
}

export interface AiPrediction {
  sample_id: number | null;
  sensor_timestamp: string | null;
  anomaly: AnomalyResult;
  vision: VisionResult;
  risk: RiskResult;
  timestamp: string;
  source: AiSource;
}

export interface StoredAiPrediction extends AiPrediction {
  id: number;
}

export interface AiServiceStatus {
  status: 'online';
  model_loaded: boolean;
  vision: VisionResult;
  latest_prediction: AiPrediction | null;
}

export interface AiStatus {
  camera_source?: 'ai' | 'external' | 'disabled';
  online: boolean;
  model_loaded: boolean;
  vision: VisionResult | null;
  last_success_at: string | null;
  last_error: string | null;
  queue_depth: number;
  dropped_samples: number;
}
