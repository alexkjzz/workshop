import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { Router } from 'express';
import type { CameraFeed } from '../../../application/ports.js';
import type { GetRecentDetections } from '../../../application/use-cases/get-recent-detections.js';
import { CameraStreamUnavailableError } from '../../../application/errors.js';

export function visionRoutes(getRecentDetections: GetRecentDetections, cameraFeed: CameraFeed) {
  const router = Router();

  router.get('/vision', (_request, response) => {
    response.json({ detections: getRecentDetections.execute() });
  });

  // Relays the vision service's MJPEG stream so the camera is only reachable
  // through an authenticated session.
  router.get(['/camera/stream', '/ai/vision/stream'], async (_request, response) => {
    if (!cameraFeed.isConfigured()) {
      response.status(503).json({ message: 'Camera stream is not configured.' });
      return;
    }

    const upstream = new AbortController();
    response.on('close', () => upstream.abort());
    let stream;
    try {
      stream = await cameraFeed.open(upstream.signal);
    } catch (error) {
      if (!upstream.signal.aborted && !response.headersSent) {
        response.status(error instanceof CameraStreamUnavailableError ? error.statusCode : 502)
          .json({ message: error instanceof Error ? error.message : 'Le flux webcam est indisponible.' });
      }
      return;
    }
    if (!stream) {
      if (!response.headersSent) response.status(502).json({ message: 'Camera stream is unavailable.' });
      return;
    }

    response.writeHead(200, {
      'Content-Type': stream.contentType,
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    Readable.fromWeb(stream.body as ReadableStream)
      .on('error', () => response.end())
      .pipe(response);
  });

  return router;
}
