import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiStatus } from '../src/domain/ai.ts';
import type { FaceRecognitionResult } from '../src/domain/faces.ts';
import {
  FACE_MAX_FILES,
  FACE_MAX_FILE_BYTES,
  FACE_MAX_TOTAL_BYTES,
  faceEnrollmentUnavailable,
  normalizeFaceName,
  validateFaceEnrollment,
} from '../src/domain/face-enrollment.ts';
import { HttpAiApi } from '../src/infrastructure/http-ai-api.ts';
import { UnauthorizedError } from '../src/application/errors.ts';

const timestamp = '2026-10-08T10:00:00.000Z';
const catalog: FaceRecognitionResult = {
  enabled: true, status: 'running', model_loaded: true, known_identities: 1, reference_images: 3,
  skipped_images: 0, identities: ['Mohamed'], threshold: .55, faces: [], history: [], timestamp,
  last_prediction_time: timestamp, loaded_at: timestamp, inference_time_ms: 20, error: null,
  reload_error: null, reloading: false, catalog_revision: 2,
};
const status: AiStatus = {
  online: true, model_loaded: false, last_success_at: timestamp, last_error: null, queue_depth: 0, dropped_samples: 0,
  vision: { status: 'running', error: null, person_detected: false, person_count: 0, max_confidence: 0,
    confirmed: false, objects: [], timestamp, fps: 15, inference_time_ms: 35, last_prediction_time: timestamp,
    detection_status: 'running', faces: catalog },
};

function image(name = 'photo.jpg', type = 'image/jpeg', size = 4): File {
  const file = new File([new Uint8Array([0, 128, 254, 255])], name, { type });
  if (size !== file.size) Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function withFetch<T>(fetchMock: typeof fetch, action: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try { return await action(); }
  finally { globalThis.fetch = original; }
}

test('enrollment normalizes Unicode identity names without losing accented names', () => {
  assert.equal(normalizeFaceName('  Ame\u0301lie  '), 'Amélie');
  for (const name of ['Mohamed', 'Élodie Dupont', '张伟']) {
    const result = validateFaceEnrollment(name, [image()]);
    assert.equal(result.error, null, name);
    assert.equal(result.name, name);
    assert.deepEqual(result.fileErrors, []);
  }
  assert.equal(validateFaceEnrollment('  Ame\u0301lie  ', [image()]).name, 'Amélie');
});

test('enrollment rejects unsafe paths, controls and reserved Windows identity names', () => {
  for (const name of ['', '   ', '.', '..', '../Mohamed', 'A/B', 'A\\B', 'A\0B', 'A\nB',
    'CON', 'nul', 'PRN.txt', 'AUX', 'COM1', 'COM¹', 'COM²', 'LPT³', 'LPT9.jpg', 'Unknown', 'Inconnu',
    'A:B', 'A*B', 'A?B', 'A"B', 'A<B', 'A>B', 'A|B', '---', 'A'.repeat(65)]) {
    assert.ok(validateFaceEnrollment(name, [image()]).error, JSON.stringify(name));
  }
  assert.equal(validateFaceEnrollment('É'.repeat(64), [image()]).error, null);
  assert.equal(validateFaceEnrollment('𐐀'.repeat(64), [image()]).error, null);
  assert.ok(validateFaceEnrollment('𐐀'.repeat(65), [image()]).error);
});

test('enrollment accepts supported JPEG, PNG and WEBP photos and reports invalid files by index', () => {
  const supported = [image('one.JPG'), image('two.jpeg'), image('three.png', 'image/png'), image('four.webp', 'image/webp')];
  assert.equal(validateFaceEnrollment('Mohamed', supported).error, null);
  const invalid = [image('first.jpg'), image('document.txt', 'text/plain'), image('empty.png', 'image/png', 0)];
  const result = validateFaceEnrollment('Mohamed', invalid);
  assert.equal(result.error, null);
  assert.deepEqual(result.fileErrors.map(({ index, filename }) => ({ index, filename })), [
    { index: 1, filename: 'document.txt' }, { index: 2, filename: 'empty.png' },
  ]);
  assert.ok(result.fileErrors.every(({ message }) => message.length > 0));
});

test('enrollment enforces count and byte limits including valid exact boundaries', () => {
  assert.equal(FACE_MAX_FILES, 5);
  assert.equal(FACE_MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(FACE_MAX_TOTAL_BYTES, 15 * 1024 * 1024);
  assert.ok(validateFaceEnrollment('Mohamed', []).error);
  assert.equal(validateFaceEnrollment('Mohamed', Array.from({ length: FACE_MAX_FILES }, () => image())).error, null);
  assert.ok(validateFaceEnrollment('Mohamed', Array.from({ length: FACE_MAX_FILES + 1 }, () => image())).error);
  const full = Array.from({ length: 3 }, (_, index) => image(`${index}.jpg`, 'image/jpeg', FACE_MAX_FILE_BYTES));
  assert.equal(validateFaceEnrollment('Mohamed', full).error, null);
  assert.ok(validateFaceEnrollment('Mohamed', [...full, image('extra.jpg')]).error);
  const tooLarge = validateFaceEnrollment('Mohamed', [image('large.jpg', 'image/jpeg', FACE_MAX_FILE_BYTES + 1)]);
  assert.deepEqual(tooLarge.fileErrors.map(({ index, filename }) => ({ index, filename })), [{ index: 0, filename: 'large.jpg' }]);
});

test('enrollment rejects invalid photo filenames and unknown file types before upload', () => {
  for (const file of [image('../photo.jpg'), image('sub\\photo.png', 'image/png'), image('a\0.jpg'),
    image('photo.gif', 'image/gif'), image('a'.repeat(256) + '.jpg'), image('photo.jpg', 'text/plain')]) {
    const result = validateFaceEnrollment('Mohamed', [file]);
    assert.equal(result.fileErrors.length, 1, file.name);
    assert.equal(result.fileErrors[0].index, 0);
    assert.equal(result.fileErrors[0].filename, file.name);
  }
  assert.equal(validateFaceEnrollment('Mohamed', [image('photo.jpg', '')]).fileErrors.length, 0);
});

test('enrollment requires an available facial model but can add photos while the webcam is stopped', () => {
  assert.equal(faceEnrollmentUnavailable(status, catalog), null);
  assert.equal(faceEnrollmentUnavailable({ ...status, vision: { ...status.vision!, status: 'stopped' } }, { ...catalog, status: 'stopped' }), null);
  assert.equal(faceEnrollmentUnavailable(status, { ...catalog, known_identities: 0, reference_images: 0, identities: [] }), null);
  assert.ok(faceEnrollmentUnavailable(null, null));
  assert.ok(faceEnrollmentUnavailable({ ...status, online: false }, catalog));
  assert.ok(faceEnrollmentUnavailable(status, null));
  assert.ok(faceEnrollmentUnavailable(status, { ...catalog, enabled: false }));
  assert.ok(faceEnrollmentUnavailable(status, { ...catalog, model_loaded: false, status: 'unavailable' }));
  assert.ok(faceEnrollmentUnavailable(status, { ...catalog, reloading: true }));
});

test('the real enrollment API sends multiple binary images as base64 through same-origin Express', async () => {
  let calls = 0;
  const response = { name: 'Amélie', added: 2, rejected: [], catalog };
  const files = [image('portrait.jpg'), new File([new Uint8Array([255, 0, 1, 127, 128])], 'profile.png', { type: 'image/png' })];
  await withFetch(async (input, init) => {
    calls++;
    assert.equal(input, '/api/ai/vision/faces/enroll');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    assert.ok(init?.signal instanceof AbortSignal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.name, 'Amélie');
    assert.deepEqual(body.images.map((item: { filename: string }) => item.filename), ['portrait.jpg', 'profile.png']);
    assert.deepEqual(Array.from(Buffer.from(body.images[0].content_base64, 'base64')), [0, 128, 254, 255]);
    assert.deepEqual(Array.from(Buffer.from(body.images[1].content_base64, 'base64')), [255, 0, 1, 127, 128]);
    return Response.json(response);
  }, async () => {
    assert.deepEqual(await new HttpAiApi().enrollFaces('  Ame\u0301lie  ', files), response);
  });
  assert.equal(calls, 1);
});

test('the real enrollment API rejects invalid batches without reading photos or calling Express', async () => {
  let reads = 0;
  let requests = 0;
  const file = image();
  Object.defineProperty(file, 'arrayBuffer', { value: async () => { reads++; return new ArrayBuffer(4); } });
  await withFetch(async () => { requests++; return Response.json({}); }, async () => {
    await assert.rejects(new HttpAiApi().enrollFaces('../Mohamed', [file]));
    await assert.rejects(new HttpAiApi().enrollFaces('Mohamed', [image('large.jpg', 'image/jpeg', FACE_MAX_FILE_BYTES + 1)]));
  });
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test('encoding a photo larger than one chunk preserves every binary byte', async () => {
  const bytes = Uint8Array.from({ length: 150_000 }, (_, index) => index % 256);
  const file = new File([bytes], 'portrait.webp', { type: 'image/webp' });
  await withFetch(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Buffer.from(body.images[0].content_base64, 'base64'), Buffer.from(bytes));
    return Response.json({ name: 'Mohamed', added: 1, rejected: [], catalog });
  }, async () => {
    await new HttpAiApi().enrollFaces('Mohamed', [file]);
  });
});

test('the real enrollment API keeps partial success and zero additions available to the UI', async () => {
  for (const added of [1, 0]) {
    const response = { name: 'Mohamed', added, rejected: [{ filename: 'profile.jpg', message: 'No usable face found.' }], catalog };
    await withFetch(async () => Response.json(response), async () => {
      assert.deepEqual(await new HttpAiApi().enrollFaces('Mohamed', [image()]), response);
    });
  }
});

test('the real enrollment API preserves authentication errors and backend validation messages', async () => {
  await withFetch(async () => Response.json({ message: 'Unauthorized' }, { status: 401 }), async () => {
    await assert.rejects(new HttpAiApi().enrollFaces('Mohamed', [image()]), UnauthorizedError);
  });
  await withFetch(async () => Response.json({ message: 'Nom de personne invalide.' }, { status: 400 }), async () => {
    await assert.rejects(new HttpAiApi().enrollFaces('Mohamed', [image()]), /Nom de personne invalide/);
  });
});

test('aborting enrollment before reading files avoids file reads and HTTP requests', async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  let requests = 0;
  const file = image();
  Object.defineProperty(file, 'arrayBuffer', { value: async () => { reads++; return new ArrayBuffer(4); } });
  await withFetch(async () => { requests++; return Response.json({}); }, async () => {
    await assert.rejects(new HttpAiApi().enrollFaces('Mohamed', [file], controller.signal), (error: Error) => error.name === 'AbortError');
  });
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test('aborting while a file is read prevents the enrollment request after the read completes', async () => {
  const controller = new AbortController();
  let finishRead!: (value: ArrayBuffer) => void;
  let announceRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { announceRead = resolve; });
  const file = image();
  Object.defineProperty(file, 'arrayBuffer', { value: () => {
    announceRead();
    return new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; });
  } });
  let requests = 0;
  await withFetch(async () => { requests++; return Response.json({}); }, async () => {
    const operation = new HttpAiApi().enrollFaces('Mohamed', [file], controller.signal);
    const rejected = assert.rejects(operation, (error: Error) => error.name === 'AbortError');
    await readStarted;
    controller.abort();
    finishRead(new ArrayBuffer(4));
    await rejected;
  });
  assert.equal(requests, 0);
});
