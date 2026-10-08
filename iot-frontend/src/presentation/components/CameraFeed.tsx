import { useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import { cameraStreamError } from '../../infrastructure/camera-stream';
import { useServices } from '../services-context';
import './CameraFeed.css';

// MJPEG is relayed by the authenticated backend; bounding boxes are drawn by Python.
export function CameraFeed({ annotated = false, onRetry, onSessionExpired }: {
  annotated?: boolean;
  onRetry?: () => void;
  onSessionExpired?: () => void;
}) {
  const { deviceApi } = useServices();
  const [streamState, setStreamState] = useState<'loading' | 'live' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  // MJPEG images may retain their last frame in the browser even with no-store.
  // Give every mounted viewer a fresh URL, including after a parent restart.
  const [connectionId] = useState(() => Date.now());
  const streamUrl = deviceApi.cameraStreamUrl(connectionId + attempt);
  const [errorMessage, setErrorMessage] = useState('Le flux de la caméra est indisponible.');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const failed = async () => {
    setStreamState('error');
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const message = await cameraStreamError(streamUrl,
        AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
      if (!controller.signal.aborted) setErrorMessage(message);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof UnauthorizedError) onSessionExpired?.();
      else setErrorMessage('Le service vidéo est injoignable. Vérifiez le service IA puis réessayez.');
    }
  };

  return (
    <div className="camera-feed">
      <p className="camera-feed-status" role="status">
        {streamState === 'live' ? 'Flux en direct' : streamState === 'error' ? 'Flux indisponible' : 'Connexion au flux...'}
        {annotated && streamState === 'live' ? ' · personnes encadrées par YOLO' : ''}
      </p>
      <div className="camera-frame">
        {streamState !== 'error' && (
          <img
            key={attempt}
            src={streamUrl}
            alt={annotated ? 'Webcam du serveur local avec détection des personnes' : 'Flux de la webcam du serveur local'}
            onLoad={() => setStreamState('live')}
            onError={() => void failed()}
          />
        )}
        {streamState !== 'live' && (
          <div className="camera-placeholder">
            {streamState === 'error' ? (
              <>
                <p>{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (onRetry) { onRetry(); return; }
                    setStreamState('loading');
                    setAttempt((value) => value + 1);
                  }}
                >
                  Réessayer
                </button>
              </>
            ) : (
              <p>Connexion au flux...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
