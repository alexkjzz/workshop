import { useCallback, useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import { mergeAiPredictions, type AiPrediction, type AiStatus } from '../../domain/ai';
import { HISTORY_SIZE, mergeReadings, type Reading } from '../../domain/telemetry';
import { mergeDetections, type VisionDetection } from '../../domain/vision';
import { useServices } from '../services-context';

// History from the API, then live updates from the feed.
export function useLiveData(onSessionExpired: () => void) {
  const { deviceApi, aiApi, liveFeed } = useServices();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [detections, setDetections] = useState<VisionDetection[]>([]);
  const [aiPredictions, setAiPredictions] = useState<AiPrediction[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiLoadError, setAiLoadError] = useState('');
  const sessionExpiredRef = useRef(onSessionExpired);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const statusRevisionRef = useRef(0);
  const requestRef = useRef(0);

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired;
  });

  const refreshAi = useCallback(async () => {
    const generation = generationRef.current;
    const statusRevision = statusRevisionRef.current;
    const request = ++requestRef.current;
    try {
      const [status, latest] = await Promise.all([aiApi.getStatus(), aiApi.getLatest()]);
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (latest) setAiPredictions((current) => mergeAiPredictions(current, [latest]));
      // A live status or a newer polling request wins over an older HTTP response.
      if (request !== requestRef.current || statusRevision !== statusRevisionRef.current) return;
      setAiStatus(status);
      setAiLoadError('');
    } catch (error) {
      if (!mountedRef.current || generation !== generationRef.current
        || request !== requestRef.current || statusRevision !== statusRevisionRef.current) return;
      if (error instanceof UnauthorizedError) sessionExpiredRef.current();
      else {
        setAiLoadError(error instanceof Error ? error.message : 'Le service IA est indisponible.');
        setAiStatus((current) => ({
          online: false,
          camera_source: current?.camera_source,
          model_loaded: current?.model_loaded ?? false,
          vision: current?.vision ?? null,
          last_success_at: current?.last_success_at ?? null,
          last_error: 'Connexion au backend interrompue.',
          queue_depth: current?.queue_depth ?? 0,
          dropped_samples: current?.dropped_samples ?? 0,
        }));
      }
    }
  }, [aiApi]);

  useEffect(() => {
    let disposed = false;
    mountedRef.current = true;
    generationRef.current += 1;

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
        if (!disposed && error instanceof UnauthorizedError) sessionExpiredRef.current();
      }
    };

    const loadAiHistory = async () => {
      try {
        const history = await aiApi.getHistory();
        if (!disposed) setAiPredictions((current) => mergeAiPredictions(current, history));
      } catch (error) {
        if (!disposed && error instanceof UnauthorizedError) sessionExpiredRef.current();
      }
    };

    const disconnect = liveFeed.connect({
      onReading: (reading) => {
        if (!disposed) setReadings((current) => mergeReadings(current, [reading]));
      },
      onDetection: (detection) => {
        if (!disposed) setDetections((current) => mergeDetections(current, [detection]));
      },
      onAiPrediction: (prediction) => {
        if (!disposed) setAiPredictions((current) => mergeAiPredictions(current, [prediction]));
      },
      onAiStatus: (status) => {
        if (disposed) return;
        statusRevisionRef.current += 1;
        setAiStatus(status);
        setAiLoadError('');
      },
      onReconnected: () => {
        if (disposed) return;
        void loadHistory();
        void loadAiHistory();
        void refreshAi();
      },
      onInterrupted: () => {
        if (disposed) return;
        sessionExpiredRef.current();
        void loadHistory();
        void loadAiHistory();
        void refreshAi();
      },
    });
    void loadHistory();
    void loadAiHistory();
    const initialStatusTimer = window.setTimeout(() => void refreshAi(), 0);
    // Availability remains visible if no sensor or SSE message arrives.
    const statusTimer = window.setInterval(() => void refreshAi(), 5000);

    return () => {
      disposed = true;
      mountedRef.current = false;
      generationRef.current += 1;
      window.clearTimeout(initialStatusTimer);
      window.clearInterval(statusTimer);
      disconnect();
    };
  }, [deviceApi, aiApi, liveFeed, refreshAi]);

  return { readings, detections, aiPredictions, aiStatus, aiLoadError, refreshAi };
}
