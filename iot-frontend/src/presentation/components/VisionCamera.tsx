import { useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import { startVisionAndWait } from '../../application/start-vision';
import type { AiStatus, AiVisionResult } from '../../domain/ai';
import { useServices } from '../services-context';
import { CameraFeed } from './CameraFeed';
import { VisionControls } from './VisionControls';

interface VisionCameraProps {
  status: AiStatus | null;
  onRefresh: () => Promise<void>;
  onSessionExpired: () => void;
}

export function VisionCamera({ status, onRefresh, onSessionExpired }: VisionCameraProps) {
  const { aiApi } = useServices();
  const [local, setLocal] = useState<AiVisionResult | null>(null);
  const [pending, setPending] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; controllerRef.current?.abort(); };
  }, []);
  const remote = status?.vision;
  const vision = local && (pending !== null || !remote || Date.parse(local.timestamp) >= Date.parse(remote.timestamp))
    ? local : remote;
  const currentStatus = status ? { ...status, vision: vision ?? null } : null;

  const command = async (start: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(start ? 'start' : 'stop');
    setError('');
    try {
      if (start) {
        const result = await startVisionAndWait(aiApi, {
          signal: controller.signal,
          onState: (state) => { if (!controller.signal.aborted && aliveRef.current) setLocal(state); },
        });
        if (controller.signal.aborted || !aliveRef.current) return;
        setLocal(result);
        setAttempt((value) => value + 1);
      } else {
        const result = await aiApi.stopVision(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
        if (controller.signal.aborted || !aliveRef.current) return;
        setLocal(result);
        if (result.status !== 'stopped') throw new Error(result.error || 'La webcam ne s’est pas arrêtée. Réessayez.');
      }
      await onRefresh();
    } catch (failure) {
      if (controller.signal.aborted || !aliveRef.current) return;
      if (failure instanceof UnauthorizedError) onSessionExpired();
      else setError(failure instanceof Error ? failure.message : 'La commande webcam a échoué.');
      await onRefresh();
    } finally {
      if (controllerRef.current === controller && aliveRef.current) setPending(null);
    }
  };

  // Existing external camera feeds still work when the optional AI service is off.
  if (status?.camera_source === 'external') {
    return <CameraFeed onSessionExpired={onSessionExpired} />;
  }

  const running = status?.online && pending === null && vision?.status === 'running' && vision.stream_ready !== false;
  return (
    <div className="vision-camera">
      <VisionControls status={currentStatus} pending={pending}
        onStart={() => void command(true)} onStop={() => void command(false)} />
      {(error || vision?.error) && <p className="vision-command-message" role="alert">{error || vision?.error}</p>}
      {!status?.online && <p className="camera-feed-status">Le service IA est indisponible. Démarrez-le pour utiliser la webcam.</p>}
      {vision?.status === 'starting' && <p className="camera-feed-status">Ouverture de la webcam du serveur…</p>}
      {running ? (
        <CameraFeed key={attempt} annotated={vision?.detection_status === 'running'}
          onRetry={() => void command(true)} onSessionExpired={onSessionExpired} />
      ) : !pending && vision?.status === 'stopped' ? (
        <p className="camera-feed-status">Webcam arrêtée. Cliquez sur « Démarrer la webcam ».</p>
      ) : null}
      {running && vision?.detection_status === 'loading' && <p className="camera-feed-status">Vidéo disponible. Chargement de la détection YOLO…</p>}
      {running && vision?.detection_error && <p className="vision-command-message">Vidéo disponible. Détection des personnes indisponible : {vision.detection_error}</p>}
    </div>
  );
}
