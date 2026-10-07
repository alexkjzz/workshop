import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraStreamUnavailableError } from '../../application/errors.js';
import { HttpCameraFeed } from './http-camera-feed.js';

test('MJPEG relay preserves content type, bearer token, streaming body and disconnect signal', async (context) => {
  let options: RequestInit | undefined;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); } });
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    options = init;
    return new Response(body, { headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' } });
  });
  const controller = new AbortController();
  const result = await new HttpCameraFeed('http://localhost/stream.mjpg', 100, 'test-token').open(controller.signal);
  assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-token');
  assert.equal(result?.contentType, 'multipart/x-mixed-replace; boundary=frame');
  assert.equal(result?.body, body);
  controller.abort();
  assert.equal(options?.signal?.aborted, true);
  await body.cancel();
});

test('upstream camera errors retain actionable reasons without becoming a browser auth error', async (context) => {
  const mocked = context.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Webcam occupée.' }, { status: 503 }));
  const feed = new HttpCameraFeed('http://localhost/stream.mjpg');
  await assert.rejects(feed.open(new AbortController().signal), (error: CameraStreamUnavailableError) => error.statusCode === 503 && /occupée/.test(error.message));
  mocked.mock.mockImplementation(async () => Response.json({ detail: 'Invalid token' }, { status: 401 }));
  await assert.rejects(feed.open(new AbortController().signal), (error: CameraStreamUnavailableError) => error.statusCode === 502 && /token/.test(error.message));
  mocked.mock.mockImplementation(async () => new Response('not-video', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(feed.open(new AbortController().signal), /MJPEG/);
});
