import type { CameraFeed, CameraStream } from '../../application/ports.js';
import { CameraStreamUnavailableError } from '../../application/errors.js';

// MJPEG stream served over HTTP by the AI team's vision script.
export class HttpCameraFeed implements CameraFeed {
  constructor(private readonly url: string, private readonly timeoutMs = 5000, private readonly token = '') {}

  isConfigured(): boolean {
    return this.url !== '';
  }

  async open(signal: AbortSignal): Promise<CameraStream | null> {
    const opening = new AbortController();
    // Only the connection opening has a timeout; a working MJPEG stream stays open.
    const timer = setTimeout(() => opening.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        signal: AbortSignal.any([signal, opening.signal]),
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { detail?: string; message?: string };
        throw new CameraStreamUnavailableError(
          response.status === 401 ? 'Le token du service IA est incorrect. Vérifiez AI_SERVICE_TOKEN côté backend et Python.'
            : detail.detail ?? detail.message ?? `Le flux webcam est indisponible (HTTP ${response.status}).`,
          response.status === 503 ? 503 : 502,
        );
      }
      if (!response.body) throw new CameraStreamUnavailableError('Le service vidéo ne fournit aucune image.');
      const contentType = response.headers.get('content-type') ?? '';
      if (!/^multipart\/x-mixed-replace\b/i.test(contentType)) {
        await response.body.cancel();
        throw new CameraStreamUnavailableError('Le flux configuré ne retourne pas de vidéo MJPEG.', 502);
      }
      return {
        contentType,
        body: response.body,
      };
    } catch (error) {
      if (signal.aborted) return null;
      if (error instanceof CameraStreamUnavailableError) throw error;
      throw new CameraStreamUnavailableError(opening.signal.aborted
        ? 'La caméra ne répond pas. Vérifiez le service IA et réessayez.'
        : 'Le service vidéo est injoignable. Vérifiez que le service IA est démarré.');
    } finally {
      clearTimeout(timer);
    }
  }
}
