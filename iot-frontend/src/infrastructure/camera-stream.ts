import { UnauthorizedError } from '../application/errors';

// Inspect errors only after an <img> failure, then close any opened stream immediately.
export async function cameraStreamError(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (response.status === 401) throw new UnauthorizedError();
  if (response.ok) {
    await response.body?.cancel();
    return 'Le flux vidéo a été interrompu. Réessayez pour reconnecter la webcam.';
  }
  const body = await response.json().catch(() => ({})) as { message?: string };
  return body.message || 'La webcam est indisponible. Vérifiez que le service IA est démarré.';
}
