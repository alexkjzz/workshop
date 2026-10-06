import { useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import { HISTORY_SIZE, mergeReadings, type Reading } from '../../domain/telemetry';
import { mergeDetections, type VisionDetection } from '../../domain/vision';
import { useServices } from '../services-context';

// History from the API, then live updates from the feed.
export function useLiveData(onSessionExpired: () => void) {
  const { deviceApi, liveFeed } = useServices();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [detections, setDetections] = useState<VisionDetection[]>([]);
  const sessionExpiredRef = useRef(onSessionExpired);

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired;
  });

  useEffect(() => {
    let disposed = false;

    const loadHistory = async () => {
      try {
        const [history, recent] = await Promise.all([
          deviceApi.getReadings(HISTORY_SIZE),
          deviceApi.getDetections(),
        ]);
        if (disposed) return;
        setReadings((current) => mergeReadings(current, history));
        setDetections((current) => mergeDetections(current, recent));
      } catch (error) {
        // An unreachable server is already reported by the status line.
        if (error instanceof UnauthorizedError) sessionExpiredRef.current();
      }
    };

    const disconnect = liveFeed.connect({
      onReading: (reading) => setReadings((current) => mergeReadings(current, [reading])),
      onDetection: (detection) => setDetections((current) => mergeDetections(current, [detection])),
      onInterrupted: () => {
        sessionExpiredRef.current();
        void loadHistory();
      },
    });
    void loadHistory();

    return () => {
      disposed = true;
      disconnect();
    };
  }, [deviceApi, liveFeed]);

  return { readings, detections };
}
