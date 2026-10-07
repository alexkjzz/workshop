import type { DeviceApi } from '../application/ports';
import type { DeviceCommand, DeviceStatus, Reading } from '../domain/telemetry';
import type { VisionDetection } from '../domain/vision';
import { jsonBody, requestJson } from './http-client';

// Same origin: Vite (or nginx) forwards /api to the backend; the session cookie follows.
export class HttpDeviceApi implements DeviceApi {
  getStatus() {
    return requestJson<DeviceStatus>('/api/status', { signal: AbortSignal.timeout(5000) }, 'Impossible de lire le statut du serveur.');
  }

  async getReadings(limit: number) {
    return (await requestJson<{ readings: Reading[] }>(`/api/readings?limit=${limit}`)).readings;
  }

  async getDetections() {
    return (await requestJson<{ detections: VisionDetection[] }>('/api/vision')).detections;
  }

  async sendCommand(command: DeviceCommand) {
    const result = await requestJson<{ message?: string }>(
      '/api/action',
      jsonBody('POST', { ordre: command }),
      'La commande a échoué.',
    );
    return result.message ?? 'Commande envoyée.';
  }

  cameraStreamUrl(attempt: number) {
    // The attempt number forces the browser to open a new connection on retry.
    return `/api/camera/stream?attempt=${attempt}`;
  }
}
