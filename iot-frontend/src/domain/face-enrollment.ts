import type { AiStatus } from './ai.ts';
import type { FaceRecognitionResult } from './faces.ts';

export const FACE_MAX_FILES = 5;
export const FACE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FACE_MAX_TOTAL_BYTES = 15 * 1024 * 1024;

interface PhotoFile {
  name: string;
  size: number;
  type: string;
}

export interface FaceEnrollmentValidation {
  name: string;
  error: string | null;
  fileErrors: Array<{ index: number; filename: string; message: string }>;
}

export function normalizeFaceName(value: string): string {
  return value.normalize('NFC').trim();
}

export function validateFaceEnrollment(name: string, files: readonly PhotoFile[]): FaceEnrollmentValidation {
  const normalized = normalizeFaceName(name);
  let error: string | null = null;
  if (!normalized) error = 'Renseignez le nom de la personne.';
  else if (Array.from(normalized).length > 64) error = 'Le nom doit contenir au maximum 64 caractères.';
  else if (!/^[\p{L}\p{N} _'-]+$/u.test(normalized) || !/[\p{L}\p{N}]/u.test(normalized)) {
    error = 'Le nom accepte les lettres, chiffres, espaces, tirets, underscores et apostrophes.';
  } else if (/^(?:unknown|inconnu|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(normalized)) {
    error = 'Ce nom est réservé. Choisissez un autre nom.';
  }
  if (!error && files.length === 0) error = 'Sélectionnez au moins une photo.';
  if (!error && files.length > FACE_MAX_FILES) error = 'Sélectionnez au maximum 5 photos par envoi.';
  if (!error && files.reduce((total, file) => total + file.size, 0) > FACE_MAX_TOTAL_BYTES) {
    error = 'Les photos doivent représenter au maximum 15 Mio par envoi.';
  }
  const fileErrors = files.flatMap((file, index) => {
    let message: string | null = null;
    if (Array.from(file.name).length > 255 || /[\\/\p{Cc}]/u.test(file.name)
      || !/\.(?:jpe?g|png|webp)$/i.test(file.name)
      || (file.type !== '' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase()))) {
      message = 'Choisissez une photo JPEG, PNG ou WEBP avec un nom de fichier valide.';
    } else if (!Number.isFinite(file.size) || file.size <= 0) {
      message = 'La photo est vide ou illisible.';
    } else if (file.size > FACE_MAX_FILE_BYTES) {
      message = 'Cette photo dépasse la limite de 5 Mio.';
    }
    return message ? [{ index, filename: file.name, message }] : [];
  });
  return { name: normalized, error, fileErrors };
}

// Enrollment uses reference photos: the webcam can remain stopped.
export function faceEnrollmentUnavailable(status: AiStatus | null,
  result: FaceRecognitionResult | null | undefined): string | null {
  if (!status?.online) return 'Le service IA doit être en ligne pour ajouter une personne.';
  if (!result) return 'Le module de reconnaissance faciale est indisponible.';
  if (!result.enabled) return 'La reconnaissance faciale est désactivée.';
  if (result.status === 'loading') return 'Le modèle facial est en cours de chargement.';
  if (!result.model_loaded || result.status === 'unavailable') return 'Le modèle facial est indisponible.';
  if (result.reloading) return 'Attendez la fin du rechargement du catalogue.';
  return null;
}
