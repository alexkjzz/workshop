import assert from 'node:assert/strict';
import test from 'node:test';
import { FaceEnrollmentError } from '../../application/errors.js';
import { faceResult } from '../../testing/face-fixture.js';
import { parseFaceEnrollment } from './ai-contract.js';
import { HttpAiGateway } from './http-ai-gateway.js';

const request = { name: 'Mohamed', images: [{ filename: 'photo.jpg', content_base64: 'Zg==' }] };
const result = () => ({ name: 'Mohamed', added: 1, rejected: [], catalog: faceResult() });

test('enrollment relay preserves its JSON contract and sends the server bearer token', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'http://127.0.0.1:8001/vision/faces/enroll');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer private-server-token');
    assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(init.body as string), request);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(result());
  });
  const gateway = new HttpAiGateway('http://127.0.0.1:8001/', 5000, 'private-server-token');
  assert.equal((await gateway.enrollFaces(request)).added, 1);
});

test('enrollment contracts accept rejected photos but reject invalid catalogs and unmatched responses', async (context) => {
  const rejected = { ...result(), added: 0, rejected: [{ filename: 'photo.jpg', message: 'Aucun visage détecté.' }] };
  assert.equal(parseFaceEnrollment(rejected).added, 0);
  for (const invalid of [{ ...result(), added: -1 }, { ...result(), added: 6 }, { ...result(), added: .5 },
    { ...result(), name: 'é'.repeat(65).normalize('NFD') },
    { ...result(), rejected: [{ filename: 'photo.jpg', message: '' }] },
    { ...result(), catalog: { ...faceResult(), known_identities: 5 } }]) {
    assert.throws(() => parseFaceEnrollment(invalid), /invalid face enrollment/);
  }
  let response: unknown = rejected;
  context.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const gateway = new HttpAiGateway('http://127.0.0.1:8001');
  assert.deepEqual(await gateway.enrollFaces(request), rejected);
  for (const invalid of [{ ...result(), name: 'Someone else' }, { ...result(), added: 0 },
    { ...rejected, rejected: [{ filename: 'different.jpg', message: 'Aucun visage.' }] }]) {
    response = invalid;
    await assert.rejects(gateway.enrollFaces(request), /does not match/);
  }
});

test('enrollment accepts the canonical existing identity name with NFC case-insensitive matching', async (context) => {
  let name = 'Mohamed';
  context.mock.method(globalThis, 'fetch', async () => Response.json({ ...result(), name }));
  const gateway = new HttpAiGateway('http://127.0.0.1:8001');
  assert.equal((await gateway.enrollFaces({ ...request, name: 'mohamed' })).name, 'Mohamed');
  name = 'Amélie';
  assert.equal((await gateway.enrollFaces({ ...request, name: 'AME\u0301LIE' })).name, 'Amélie');
  name = 'é'.repeat(64).normalize('NFD');
  assert.equal(name.length, 128);
  assert.equal((await gateway.enrollFaces({ ...request, name: 'é'.repeat(64) })).name, name);
  name = 'SS';
  await assert.rejects(gateway.enrollFaces({ ...request, name: 'ß' }), /does not match/);
});

test('enrollment propagates actionable HTTP errors without returning validation input photos', async (context) => {
  let status = 400;
  let detail: unknown = 'Choisissez un nom valide.';
  context.mock.method(globalThis, 'fetch', async () => Response.json({ detail }, { status }));
  const gateway = new HttpAiGateway('http://127.0.0.1:8001');
  for (const code of [400, 413, 422, 503]) {
    status = code;
    await assert.rejects(gateway.enrollFaces(request), (error: unknown) => error instanceof FaceEnrollmentError
      && error.statusCode === code && error.message === detail);
  }
  status = 422;
  detail = [{ loc: ['body', 'images'], msg: 'Invalid value', input: 'PRIVATE_PHOTO_CONTENT' }];
  await assert.rejects(gateway.enrollFaces(request), (error: unknown) => error instanceof FaceEnrollmentError
    && error.statusCode === 422 && !error.message.includes('PRIVATE_PHOTO_CONTENT') && /invalides/.test(error.message));
});
