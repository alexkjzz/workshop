import type { FaceRecognitionResult } from './faces';

export type AnomalyStatus = 'ready' | 'untrained' | 'insufficient_data' | 'error';
export type VisionStatus = 'stopped' | 'starting' | 'running' | 'unavailable' | 'error';
export type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ThreatCategory = 'SAFE' | 'INTRUSION' | 'ENVIRONMENT' | 'MULTI_THREAT' | 'SENSOR_ANOMALY';

export interface AnomalyResult {
  status: AnomalyStatus;
  is_anomaly: boolean | null;
  anomaly_score: number | null;
  confidence: number | null;
  reason: string;
  features: Record<string, number>;
  missing_fields: string[];
  timestamp: string;
}

export interface PersonObject {
  class: 'person';
  confidence: number;
  bbox: [number, number, number, number];
  track_id?: number | null;
}

export interface AiVisionResult {
  status: VisionStatus;
  error: string | null;
  person_detected: boolean;
  person_count: number;
  max_confidence: number;
  confirmed: boolean;
  objects: PersonObject[];
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
  risk_level: RiskLevel;
  category: ThreatCategory;
  reasons: string[];
  confidence: number;
  degraded: boolean;
  timestamp: string;
}

export interface AiPrediction {
  id: number;
  sample_id: number | null;
  sensor_timestamp: string | null;
  anomaly: AnomalyResult;
  vision: AiVisionResult;
  risk: RiskResult;
  timestamp: string;
  source: 'live' | 'simulation';
}

export interface AiStatus {
  camera_source?: 'ai' | 'external' | 'disabled';
  online: boolean;
  model_loaded: boolean;
  vision: AiVisionResult | null;
  last_success_at: string | null;
  last_error: string | null;
  queue_depth: number;
  dropped_samples: number;
}

export const AI_HISTORY_SIZE = 50;
const CURRENT_VISION_MS = 5000;

export function currentAiVision(vision: AiVisionResult | null | undefined, now: number): AiVisionResult | null {
  if (!vision || vision.status !== 'running' || !vision.last_prediction_time
    || (vision.detection_status != null && vision.detection_status !== 'running')) return null;
  const age = now - Date.parse(vision.last_prediction_time);
  return Number.isFinite(age) && age >= 0 && age < CURRENT_VISION_MS ? vision : null;
}

export function personDetectionLabel(status: AiStatus | null, now: number): string {
  if (!status) return 'Connexion à la détection de personnes…';
  if (!status.online) return 'Détection de personnes indisponible : le service IA est hors ligne.';
  const vision = status.vision;
  if (!vision) return 'En attente des résultats de détection.';
  if (vision.status === 'stopped') return 'Webcam arrêtée. Démarrez-la pour détecter les personnes.';
  if (vision.status === 'starting') return 'Démarrage de la webcam…';
  if (vision.status !== 'running') return 'Détection de personnes indisponible : la webcam ne fournit pas d’images.';
  if (vision.detection_status === 'loading') return 'Vidéo disponible. Chargement du détecteur de personnes…';
  if (vision.detection_status != null && vision.detection_status !== 'running') {
    return 'Vidéo disponible. La détection de personnes est indisponible.';
  }
  const current = currentAiVision(vision, now);
  if (!current) return 'En attente d’une analyse récente de la caméra.';
  if (current.person_count === 0) return 'Aucune personne détectée lors de la dernière analyse.';
  const people = current.person_count === 1 ? '1 personne détectée' : `${current.person_count} personnes détectées`;
  return `${people} · ${current.confirmed ? 'présence confirmée' : 'confirmation en cours'}`;
}

// Several sensor/status results can contain the same camera inference.
// Keep only successful, distinct camera analyses, using their own timestamps.
export function personDetectionHistory(predictions: AiPrediction[]): AiVisionResult[] {
  const byTime = new Map<number, AiVisionResult>();
  for (const { vision } of predictions) {
    if (vision.status !== 'running' || !vision.last_prediction_time
      || (vision.detection_status != null && vision.detection_status !== 'running')) continue;
    const time = Date.parse(vision.last_prediction_time);
    if (Number.isFinite(time) && !byTime.has(time)) byTime.set(time, vision);
  }
  return [...byTime.entries()].sort(([a], [b]) => b - a).map(([, vision]) => vision);
}

// Persisted IDs identify both history rows and their later live replay.
export function mergeAiPredictions(current: AiPrediction[], incoming: AiPrediction[]): AiPrediction[] {
  const byId = new Map([...current, ...incoming].map((prediction) => [prediction.id, prediction]));
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.id - a.id)
    .slice(0, AI_HISTORY_SIZE);
}

export function anomalyLabel(anomaly: AnomalyResult | null | undefined): string {
  if (!anomaly) return 'En attente';
  if (anomaly.status === 'untrained') return 'Modèle non entraîné';
  if (anomaly.status === 'insufficient_data') return 'Données insuffisantes';
  if (anomaly.status === 'error') return 'Analyse indisponible';
  if (anomaly.is_anomaly === null) return 'En attente';
  return anomaly.is_anomaly ? 'ANOMALY' : 'NORMAL';
}

export function riskLabel(risk: RiskResult | null | undefined): string {
  if (!risk) return 'En attente';
  if (risk.degraded && risk.risk_level === 'SAFE') return 'INDÉTERMINÉ';
  return `${risk.risk_level}${risk.degraded ? ' · partiel' : ''}`;
}

export function predictionEvents(prediction: AiPrediction): string[] {
  const events: string[] = [];
  if (prediction.vision.status === 'running' && prediction.vision.confirmed) {
    events.push('PERSON DETECTED');
    if (prediction.anomaly.features.presence === 1) events.push('PIR CONFIRMED');
  }
  if (prediction.anomaly.status === 'ready' && prediction.anomaly.is_anomaly) events.push('SENSOR ANOMALY');
  if (prediction.risk.risk_level !== 'SAFE') events.push(`RISK ${prediction.risk.risk_level}`);
  if (events.length === 0) events.push(prediction.risk.degraded ? 'ANALYSE PARTIELLE' : 'NORMAL');
  return events;
}
