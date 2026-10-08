import type { FaceEnrollmentRequest } from '../domain/faces.js';
import { FaceEnrollmentError } from './errors.js';

export const FACE_ENROLLMENT_MAX_IMAGES = 5;
export const FACE_ENROLLMENT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const FACE_ENROLLMENT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateFaceEnrollment(value: unknown): FaceEnrollmentRequest {
  if (!object(value) || typeof value.name !== 'string') {
    throw new FaceEnrollmentError('Indiquez un nom et au moins une photo.', 400);
  }
  const name = value.name.normalize('NFC').trim();
  if (!name || Array.from(name).length > 64 || !/^[\p{L}\p{N} _'-]+$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|UNKNOWN|INCONNU)$/i.test(name)) {
    throw new FaceEnrollmentError('Nom invalide : utilisez 1 à 64 lettres, chiffres, espaces, tirets ou apostrophes, sans nom réservé.', 400);
  }
  if (!Array.isArray(value.images) || value.images.length < 1 || value.images.length > FACE_ENROLLMENT_MAX_IMAGES) {
    throw new FaceEnrollmentError('Sélectionnez entre 1 et 5 photos JPEG, PNG ou WEBP.', 400);
  }
  let totalBytes = 0;
  const images = value.images.map((image) => {
    if (!object(image) || typeof image.filename !== 'string' || !image.filename
      || Array.from(image.filename).length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(image.filename)
      || !/\.(?:jpe?g|png|webp)$/i.test(image.filename) || typeof image.content_base64 !== 'string') {
      throw new FaceEnrollmentError('Chaque photo doit avoir un nom de fichier JPEG, PNG ou WEBP et un contenu base64.', 400);
    }
    const encoded = image.content_base64;
    if (encoded.length > Math.ceil(FACE_ENROLLMENT_MAX_IMAGE_BYTES / 3) * 4) {
      throw new FaceEnrollmentError('Chaque photo doit peser au maximum 5 Mio.', 413);
    }
    if (!encoded.length || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new FaceEnrollmentError('Le contenu d’une photo n’est pas un base64 valide.', 400);
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.toString('base64') !== encoded) {
      throw new FaceEnrollmentError('Le contenu d’une photo n’est pas un base64 canonique.', 400);
    }
    if (decoded.length > FACE_ENROLLMENT_MAX_IMAGE_BYTES) {
      throw new FaceEnrollmentError('Chaque photo doit peser au maximum 5 Mio.', 413);
    }
    totalBytes += decoded.length;
    if (totalBytes > FACE_ENROLLMENT_MAX_TOTAL_BYTES) {
      throw new FaceEnrollmentError('Les photos doivent peser au maximum 15 Mio au total.', 413);
    }
    return { filename: image.filename, content_base64: encoded };
  });
  return { name, images };
}
