import { validateFaceEnrollment } from '../domain/face-enrollment.ts';

function readPhoto(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    // Blob.arrayBuffer has no cancellation API. Discard its bounded result on abort.
    file.arrayBuffer().then((buffer) => {
      signal.removeEventListener('abort', aborted);
      if (signal.aborted) reject(signal.reason);
      else resolve(buffer);
    }, (error: unknown) => {
      signal.removeEventListener('abort', aborted);
      reject(error);
    });
    if (signal.aborted) aborted();
  });
}

export async function faceEnrollmentPayload(name: string, files: File[], signal: AbortSignal) {
  signal.throwIfAborted();
  const validation = validateFaceEnrollment(name, files);
  const error = validation.error || validation.fileErrors[0]?.message;
  if (error) throw new Error(error);
  const images: Array<{ filename: string; content_base64: string }> = [];
  for (const file of files) {
    const bytes = new Uint8Array(await readPhoto(file, signal));
    signal.throwIfAborted();
    let binary = '';
    // Bounded chunks avoid exceeding the JS function argument limit for large photos.
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    images.push({ filename: file.name, content_base64: btoa(binary) });
  }
  signal.throwIfAborted();
  return { name: validation.name, images };
}
