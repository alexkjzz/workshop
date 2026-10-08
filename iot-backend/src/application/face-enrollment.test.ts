import assert from 'node:assert/strict';
import test from 'node:test';
import { FaceEnrollmentError } from './errors.js';
import { FACE_ENROLLMENT_MAX_IMAGE_BYTES, validateFaceEnrollment } from './face-enrollment.js';

const image = (content_base64 = 'Zg==', filename = 'photo.jpg') => ({ filename, content_base64 });
const request = (name = 'Mohamed', images = [image()]) => ({ name, images });
const expectStatus = (value: unknown, status: number) => assert.throws(() => validateFaceEnrollment(value),
  (error: unknown) => error instanceof FaceEnrollmentError && error.statusCode === status);

test('face enrollment normalizes Unicode names and keeps photo names as metadata', () => {
  assert.deepEqual(validateFaceEnrollment(request('  Ame\u0301lie O\'Neil_2-ابن  ', [image('Zg==', 'portrait.PNG')])),
    request('Amélie O\'Neil_2-ابن', [image('Zg==', 'portrait.PNG')]));
  assert.equal(validateFaceEnrollment(request('𐐀'.repeat(64))).name.length, 128);
  assert.equal(validateFaceEnrollment(request('_Alice')).name, '_Alice');
  assert.equal(validateFaceEnrollment(request('A', Array(5).fill(image()))).images.length, 5);
});

test('face enrollment rejects traversal, reserved identities and invalid request shapes', () => {
  for (const name of ['', ' ', '--', '___', "' _- '", '.', '..', 'A/B', 'A\\B', 'A\nB', 'A😀', 'A'.repeat(65), '𐐀'.repeat(65),
    'CON', 'prn', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'COM¹', 'LPT²', 'Unknown', ' inconnu ']) {
    expectStatus(request(name), 400);
  }
  for (const value of [null, [], {}, { name: 1, images: [image()] }, request('A', []),
    request('A', Array(6).fill(image())), request('A', [image('Zg==', '../photo.jpg')]),
    request('A', [image('Zg==', 'dir\\photo.jpg')]), request('A', [image('Zg==', 'photo.gif')]),
    request('A', [image('Zg==', 'photo\u0000.jpg')]), request('A', [image('Zg==', `${'a'.repeat(256)}.jpg`)])]) {
    expectStatus(value, 400);
  }
});

test('face enrollment requires canonical padded base64 without data URLs or whitespace', () => {
  for (const encoded of ['', 'Zg', 'Zh==', 'Zg===', 'Zg==\n', 'Zg-_', 'data:image/jpeg;base64,Zg==', '=Zg=']) {
    expectStatus(request('A', [image(encoded)]), 400);
  }
  assert.equal(validateFaceEnrollment(request('A', [image('AAEC')])).images[0].content_base64, 'AAEC');
});

test('face enrollment enforces decoded per-image and aggregate size before transport', () => {
  const exactLimit = Buffer.alloc(FACE_ENROLLMENT_MAX_IMAGE_BYTES).toString('base64');
  assert.equal(validateFaceEnrollment(request('A', Array(3).fill(image(exactLimit)))).images.length, 3);
  expectStatus(request('A', Array(4).fill(image(exactLimit))), 413);
  expectStatus(request('A', [image(Buffer.alloc(FACE_ENROLLMENT_MAX_IMAGE_BYTES + 1).toString('base64'))]), 413);
  expectStatus(request('A', [image('A'.repeat(exactLimit.length + 4))]), 413);
});
