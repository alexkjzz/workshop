import type { AiStatus } from '../../domain/ai';
import './VisionControls.css';

interface VisionControlsProps {
  status: AiStatus | null;
  pending: 'start' | 'stop' | null;
  onStart: () => void;
  onStop: () => void;
}

export function VisionControls({ status, pending, onStart, onStop }: VisionControlsProps) {
  const active = status?.vision?.status === 'running' || status?.vision?.status === 'starting';

  return (
    <div className="vision-controls">
      <div className="vision-buttons">
        <button type="button" disabled={!status?.online || active || pending !== null} onClick={onStart}>
          {pending === 'start' ? 'Démarrage de la webcam...' : 'Démarrer la webcam'}
        </button>
        <button type="button" disabled={!status?.online || (!active && pending !== 'start') || pending === 'stop'} onClick={onStop}>
          {pending === 'stop' ? 'Arrêt de la webcam...' : 'Arrêter la webcam'}
        </button>
      </div>
    </div>
  );
}
