import type { CameraFeed, CameraStream } from '../../application/ports.js';

// MJPEG stream served over HTTP by the AI team's vision script.
export class HttpCameraFeed implements CameraFeed {
  constructor(private readonly url: string) {}

  isConfigured(): boolean {
    return this.url !== '';
  }

  async open(signal: AbortSignal): Promise<CameraStream | null> {
    try {
      const response = await fetch(this.url, { signal });
      if (!response.ok || !response.body) return null;
      return {
        contentType: response.headers.get('content-type') ?? 'multipart/x-mixed-replace',
        body: response.body,
      };
    } catch {
      return null;
    }
  }
}
