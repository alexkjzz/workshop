import type { LiveFeed, LiveFeedHandlers } from '../application/ports';
import type { AiPrediction, AiStatus } from '../domain/ai';
import type { Reading } from '../domain/telemetry';
import type { VisionDetection } from '../domain/vision';

const RECONNECT_DELAY_MS = 5000;

// Server-Sent Events from /api/stream.
export class SseLiveFeed implements LiveFeed {
  connect(handlers: LiveFeedHandlers) {
    let source: EventSource | undefined;
    let retryTimer: number | undefined;
    let closed = false;
    let connectedOnce = false;

    const open = () => {
      if (closed) return;
      window.clearTimeout(retryTimer);
      source?.close();
      source = new EventSource('/api/stream');
      source.addEventListener('open', () => {
        if (closed) return;
        if (connectedOnce) handlers.onReconnected();
        connectedOnce = true;
      });
      source.addEventListener('reading', (event) => handlers.onReading(JSON.parse(event.data) as Reading));
      source.addEventListener('vision', (event) =>
        handlers.onDetection(JSON.parse(event.data) as VisionDetection),
      );
      source.addEventListener('ai', (event) => handlers.onAiPrediction(JSON.parse(event.data) as AiPrediction));
      source.addEventListener('ai-status', (event) => handlers.onAiStatus(JSON.parse(event.data) as AiStatus));
      source.addEventListener('error', () => {
        // Network errors reconnect on their own; an HTTP error closes the stream for good.
        if (source?.readyState !== EventSource.CLOSED || closed) return;
        handlers.onInterrupted();
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(open, RECONNECT_DELAY_MS);
      });
    };

    open();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      source?.close();
    };
  }
}
