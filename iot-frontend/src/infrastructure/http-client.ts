import { UnauthorizedError } from '../application/errors';

// JSON request to the same-origin API; the session cookie follows.
export async function requestJson<T>(path: string, init?: RequestInit, fallbackError = 'Erreur de connexion.'): Promise<T> {
  const response = await fetch(path, init);
  if (response.status === 401) throw new UnauthorizedError();
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? fallbackError);
  return body;
}

export function jsonBody(method: string, value: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}
