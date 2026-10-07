import type { AiApi } from './ports';
import type { AiVisionResult } from '../domain/ai';

interface StartOptions {
  signal?: AbortSignal;
  onState?: (vision: AiVisionResult) => void;
  timeoutMs?: number;
  intervalMs?: number;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

// A successful POST can still mean starting. Only running with a frame permits video.
export async function startVisionAndWait(api: Pick<AiApi, 'startVision' | 'getVisionStatus'>,
  { signal: caller, onState, timeoutMs = 20_000, intervalMs = 1000 }: StartOptions = {}): Promise<AiVisionResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    let vision = await api.startVision(signal);
    while (true) {
      signal.throwIfAborted();
      onState?.(vision);
      if (vision.status === 'running' && vision.stream_ready !== false) return vision;
      if (vision.status === 'error' || vision.status === 'unavailable') {
        throw new Error(vision.error || 'La webcam est introuvable ou occupée. Vérifiez les autorisations caméra de Windows.');
      }
      if (vision.status === 'stopped') {
        throw new Error(vision.error || 'La webcam est encore en cours d’arrêt. Attendez quelques secondes puis réessayez.');
      }
      await pause(intervalMs, signal);
      vision = await api.getVisionStatus(signal);
    }
  } catch (error) {
    if (timeout.aborted && !caller?.aborted) throw new Error('Le démarrage de la webcam prend trop de temps. Fermez les autres applications caméra puis réessayez.');
    throw error;
  }
}
