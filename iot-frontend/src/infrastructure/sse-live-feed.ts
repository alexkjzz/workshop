import type { LiveFeed, LiveFeedHandlers } from '../application/ports';
import type { Reading } from '../domain/telemetry';
import type { VisionDetection } from '../domain/vision';

const RECONNECT_DELAY_MS = 5000;

// Server-Sent Events from /api/stream.
export class SseLiveFeed implements LiveFeed {
  connect(handlers: LiveFeedHandlers) {
    let source: EventSource | undefined;
    let retryTimer: number | undefined;
    let closed = false;

    const open = () => {
      source = new EventSource('/api/stream');
      source.addEventListener('reading', (event) => handlers.onReading(JSON.parse(event.data) as Reading));
      source.addEventListener('vision', (event) =>
        handlers.onDetection(JSON.parse(event.data) as VisionDetection),
      );
      source.addEventListener('error', () => {
        // Network errors reconnect on their own; an HTTP error closes the stream for good.
        if (source?.readyState !== EventSource.CLOSED || closed) return;
        handlers.onInterrupted();
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
