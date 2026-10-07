import type { AiApi } from '../application/ports';
import type { AiPrediction, AiStatus, AiVisionResult } from '../domain/ai';
import type { FaceDetection, FaceLatest, FaceRecognitionResult } from '../domain/faces';
import { jsonBody, requestJson } from './http-client';

// The backend owns AI availability, persistence and access to the local webcam.
export class HttpAiApi implements AiApi {
  getStatus() {
    return requestJson<AiStatus>('/api/ai/status', undefined, 'Le service IA est indisponible.');
  }

  getLatest() {
    return requestJson<AiPrediction | null>('/api/ai/latest');
  }

  async getHistory() {
    return (await requestJson<{ predictions: AiPrediction[] }>('/api/ai/history')).predictions;
  }

  getVisionStatus(signal?: AbortSignal) {
    return requestJson<AiVisionResult>('/api/ai/vision/status', { signal }, 'Impossible de lire le statut de la webcam.');
  }

  startVision(signal?: AbortSignal) {
    return requestJson<AiVisionResult>('/api/ai/vision/start', { ...jsonBody('POST', {}), signal }, 'Impossible de démarrer la webcam.');
  }

  stopVision(signal?: AbortSignal) {
    return requestJson<AiVisionResult>('/api/ai/vision/stop', { ...jsonBody('POST', {}), signal }, 'Impossible d’arrêter la webcam.');
  }

  getFacesStatus(signal?: AbortSignal) {
    return requestJson<FaceRecognitionResult>('/api/ai/vision/faces/status', { signal });
  }

  getFacesLatest(signal?: AbortSignal) {
    return requestJson<FaceLatest>('/api/ai/vision/faces/latest', { signal });
  }

  async getFacesHistory(signal?: AbortSignal) {
    return (await requestJson<{ faces: FaceDetection[] }>('/api/ai/vision/faces/history', { signal })).faces;
  }

  reloadFaces(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(65000);
    return requestJson<FaceRecognitionResult>('/api/ai/vision/faces/reload', {
      ...jsonBody('POST', {}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }, 'Impossible de recharger les visages connus.');
  }
}
