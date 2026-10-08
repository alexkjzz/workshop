import type { AiPrediction, AiServiceStatus, VisionResult } from '../../domain/ai.js';
import type { FaceDetection, FaceEnrollmentResult, FaceHistory, FaceLatest, FaceRecognitionResult } from '../../domain/faces.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min = -Infinity, max = Infinity): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value: unknown): value is number => number(value, 0) && Number.isInteger(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);
const nullableScore = (value: unknown) => value === null || number(value, 0, 1);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const faceStatuses = ['disabled', 'loading', 'running', 'stopped', 'unavailable', 'error'];

function isFace(value: unknown): value is FaceDetection {
  if (!object(value)) return false;
  return typeof value.face_id === 'string' && value.face_id.length > 0 && typeof value.name === 'string'
    && value.name.length > 0 && typeof value.known === 'boolean'
    && (value.known ? value.name !== 'Unknown' : value.name === 'Unknown')
    && number(value.confidence, 0, 1) && (value.similarity === null || number(value.similarity, -1, 1))
    && number(value.detection_confidence, 0, 1) && typeof value.recognizable === 'boolean'
    && (value.reason === null || typeof value.reason === 'string')
    && Array.isArray(value.bbox) && value.bbox.length === 4 && value.bbox.every((item) => number(item, 0))
    && timestamp(value.timestamp) && (value.tracker_id === null || integer(value.tracker_id));
}

function faceArray(value: unknown, limit: number): value is FaceDetection[] {
  return Array.isArray(value) && value.length <= limit && value.every(isFace);
}

function isFaces(value: unknown): value is FaceRecognitionResult {
  if (!object(value)) return false;
  return typeof value.enabled === 'boolean' && faceStatuses.includes(String(value.status))
    && typeof value.model_loaded === 'boolean' && integer(value.known_identities)
    && integer(value.reference_images) && integer(value.skipped_images) && strings(value.identities)
    && value.known_identities === value.identities.length && number(value.threshold, Number.EPSILON, 1)
    && faceArray(value.faces, 20) && faceArray(value.history, 20) && timestamp(value.timestamp)
    && nullableTimestamp(value.last_prediction_time) && nullableTimestamp(value.loaded_at)
    && number(value.inference_time_ms, 0) && typeof value.reloading === 'boolean' && integer(value.catalog_revision)
    && (value.error === null || typeof value.error === 'string')
    && (value.reload_error === null || typeof value.reload_error === 'string');
}

export function parseFaces(value: unknown): FaceRecognitionResult {
  if (!isFaces(value)) throw new Error('AI service returned invalid face recognition metadata.');
  return value;
}

export function parseFaceLatest(value: unknown): FaceLatest {
  if (!object(value) || !faceArray(value.faces, 20) || !nullableTimestamp(value.timestamp)
    || !faceStatuses.includes(String(value.status))) throw new Error('AI service returned invalid latest faces.');
  return value as unknown as FaceLatest;
}

export function parseFaceHistory(value: unknown): FaceHistory {
  if (!object(value) || !faceArray(value.faces, 20)) throw new Error('AI service returned invalid face history.');
  return value as unknown as FaceHistory;
}

export function parseFaceEnrollment(value: unknown): FaceEnrollmentResult {
  if (!object(value) || typeof value.name !== 'string' || !value.name || Array.from(value.name.normalize('NFC')).length > 64
    || !integer(value.added) || value.added > 5 || !Array.isArray(value.rejected) || value.rejected.length > 5
    || value.added + value.rejected.length > 5
    || !value.rejected.every((item) => object(item) && typeof item.filename === 'string'
      && item.filename.length > 0 && Array.from(item.filename).length <= 255
      && typeof item.message === 'string' && item.message.length > 0 && item.message.length <= 1000)
    || !isFaces(value.catalog)) {
    throw new Error('AI service returned invalid face enrollment metadata.');
  }
  return value as unknown as FaceEnrollmentResult;
}

function isVision(value: unknown): value is VisionResult {
  if (!object(value)) return false;
  return ['stopped', 'starting', 'running', 'unavailable', 'error'].includes(String(value.status))
    && (value.error === null || typeof value.error === 'string')
    && typeof value.person_detected === 'boolean' && integer(value.person_count)
    && number(value.max_confidence, 0, 1) && typeof value.confirmed === 'boolean'
    && timestamp(value.timestamp) && number(value.fps, 0) && number(value.inference_time_ms, 0)
    && nullableTimestamp(value.last_prediction_time)
    && (value.stream_ready === undefined || typeof value.stream_ready === 'boolean')
    && (value.camera_index === undefined || value.camera_index === null || integer(value.camera_index))
    && (value.last_frame_time === undefined || nullableTimestamp(value.last_frame_time))
    && (value.detection_status === undefined || value.detection_status === null
      || ['loading', 'running', 'unavailable', 'error', 'stopped'].includes(String(value.detection_status)))
    && (value.detection_error === undefined || value.detection_error === null || typeof value.detection_error === 'string')
    && (value.faces === undefined || value.faces === null || isFaces(value.faces))
    && Array.isArray(value.objects) && value.objects.length <= 100
    && value.objects.every((item) => object(item) && item.class === 'person'
      && number(item.confidence, 0, 1) && Array.isArray(item.bbox) && item.bbox.length === 4
      && item.bbox.every((coordinate) => number(coordinate))
      && (item.track_id === undefined || item.track_id === null || integer(item.track_id)));
}

function isPrediction(value: unknown): value is AiPrediction {
  if (!object(value) || !object(value.anomaly) || !object(value.risk)) return false;
  const { anomaly, risk } = value;
  return (value.sample_id === null || integer(value.sample_id)) && nullableTimestamp(value.sensor_timestamp)
    && timestamp(value.timestamp) && ['live', 'simulation'].includes(String(value.source))
    && ['ready', 'untrained', 'insufficient_data', 'error'].includes(String(anomaly.status))
    && (anomaly.is_anomaly === null || typeof anomaly.is_anomaly === 'boolean')
    && nullableScore(anomaly.anomaly_score) && nullableScore(anomaly.confidence)
    && typeof anomaly.reason === 'string' && object(anomaly.features)
    && Object.values(anomaly.features).every((feature) => number(feature))
    && strings(anomaly.missing_fields) && timestamp(anomaly.timestamp)
    && number(risk.risk_score, 0, 100) && Number.isInteger(risk.risk_score)
    && ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(risk.risk_level))
    && ['SAFE', 'INTRUSION', 'ENVIRONMENT', 'MULTI_THREAT', 'SENSOR_ANOMALY'].includes(String(risk.category))
    && strings(risk.reasons) && number(risk.confidence, 0, 1) && typeof risk.degraded === 'boolean'
    && timestamp(risk.timestamp) && isVision(value.vision);
}

export function parseAiPrediction(value: unknown): AiPrediction {
  if (!isPrediction(value)) throw new Error('AI service returned an invalid prediction.');
  return value;
}

export function parseAiVision(value: unknown): VisionResult {
  if (!isVision(value)) throw new Error('AI service returned invalid vision metadata.');
  return value;
}

export function parseAiStatus(value: unknown): AiServiceStatus {
  if (!object(value) || value.status !== 'online' || typeof value.model_loaded !== 'boolean'
    || !isVision(value.vision) || !(value.latest_prediction === null || isPrediction(value.latest_prediction))) {
    throw new Error('AI service returned an invalid status.');
  }
  return value as unknown as AiServiceStatus;
}
