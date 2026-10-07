import { currentAiVision, type AiStatus } from './ai.ts';

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

export function currentFaces(result: FaceRecognitionResult | null | undefined, now: number): FaceDetection[] | null {
  if (result?.status !== 'running' || !result.last_prediction_time) return null;
  const age = now - Date.parse(result.last_prediction_time);
  return Number.isFinite(age) && age >= 0 && age < 5000 ? result.faces : null;
}

export function faceRecognitionLabel(status: AiStatus | null, result: FaceRecognitionResult | null | undefined, now: number): string {
  if (!status) return 'Connexion à la reconnaissance faciale…';
  if (!status.online) return 'Reconnaissance faciale indisponible : le service IA est hors ligne.';
  if (!result) return status.vision
    ? 'Service facial non chargé. Redémarrez le service IA et le backend pour activer la reconnaissance faciale.'
    : 'En attente des résultats de reconnaissance faciale.';
  if (!result.enabled) return 'Reconnaissance faciale désactivée.';
  if (!result.model_loaded && result.status === 'loading') return 'Chargement du modèle facial…';
  if (!result.model_loaded || result.status === 'unavailable') return 'Modèle facial indisponible.';
  if (status.vision?.status === 'stopped') return 'Caméra arrêtée. Démarrez-la pour reconnaître les visages.';
  if (status.vision?.status !== 'running') return 'En attente des images de la caméra.';
  if (result.reloading) return 'Rechargement des visages connus…';
  if (result.status === 'error') return 'Analyse faciale indisponible.';
  const faces = currentFaces(result, now);
  if (!faces) return 'En attente d’une analyse faciale récente.';
  if (faces.length > 0) return faces.length === 1 ? '1 visage détecté' : `${faces.length} visages détectés`;
  if (currentAiVision(status.vision, now)?.person_count) return 'Personne détectée, visage non identifiable';
  return 'Aucun visage détecté actuellement';
}
