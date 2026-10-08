export type FaceStatus = 'disabled' | 'loading' | 'running' | 'stopped' | 'unavailable' | 'error';

export interface FaceDetection {
  face_id: string;
  name: string;
  known: boolean;
  confidence: number;
  similarity: number | null;
  detection_confidence: number;
  recognizable: boolean;
  reason: string | null;
  bbox: [number, number, number, number];
  timestamp: string;
  tracker_id: number | null;
}

export interface FaceRecognitionResult {
  enabled: boolean;
  status: FaceStatus;
  model_loaded: boolean;
  known_identities: number;
  reference_images: number;
  skipped_images: number;
  identities: string[];
  threshold: number;
  faces: FaceDetection[];
  history: FaceDetection[];
  timestamp: string;
  last_prediction_time: string | null;
  loaded_at: string | null;
  inference_time_ms: number;
  error: string | null;
  reload_error: string | null;
  reloading: boolean;
  catalog_revision: number;
}

export interface FaceLatest {
  faces: FaceDetection[];
  timestamp: string | null;
  status: FaceStatus;
}

export interface FaceHistory { faces: FaceDetection[] }

export interface FaceEnrollmentImage {
  filename: string;
  content_base64: string;
}

export interface FaceEnrollmentRequest {
  name: string;
  images: FaceEnrollmentImage[];
}

export interface FaceEnrollmentResult {
  name: string;
  added: number;
  rejected: { filename: string; message: string }[];
  catalog: FaceRecognitionResult;
}
