import { Router } from 'express';
import type { LiveEvent, LiveEvents } from '../../../application/ports.js';
import { currentSession } from '../middleware/require-session.js';

const HEARTBEAT_MS = 15_000;

function serialize(event: LiveEvent) {
  const data = event.type === 'reading' ? event.reading
    : event.type === 'vision' ? event.detection
    : event.type === 'ai' ? event.prediction : event.status;
  return `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function liveRoutes(liveEvents: LiveEvents) {
  const router = Router();

  // Live readings and detections (Server-Sent Events). The stream ends when
  // the session expires so the client falls back to the login screen.
  router.get('/stream', (request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(': connected\n\n');

    const unsubscribe = liveEvents.subscribe((event) => response.write(serialize(event)));
    const expiresAt = currentSession(response).expiresAt.getTime();
    const heartbeat = setInterval(() => {
      if (Date.now() >= expiresAt) response.end();
      else response.write(': ping\n\n');
    }, HEARTBEAT_MS);

    request.socket.setTimeout(0);
    response.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
