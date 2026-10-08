import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveFeedHandlers } from '../src/application/ports.ts';
import { SseLiveFeed } from '../src/infrastructure/sse-live-feed.ts';

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  url: string;
  listeners = new Map<string, ((event: { data: string }) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() { this.closed = true; }
  emit(type: string, data = '') {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

test('native and explicit SSE reconnects recover history, while cleanup prevents new connections', (context) => {
  const originalSource = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const retries = new Map<number, () => void>();
  let timerId = 0;
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (callback: () => void) => { retries.set(++timerId, callback); return timerId; },
      clearTimeout: (id: number) => retries.delete(id),
    },
  });
  context.after(() => {
    if (originalSource) Object.defineProperty(globalThis, 'EventSource', originalSource);
    else Reflect.deleteProperty(globalThis, 'EventSource');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  FakeEventSource.instances = [];
  let recovered = 0;
  let interrupted = 0;
  let predictionId: number | undefined;
  const handlers: LiveFeedHandlers = {
    onReading: () => {}, onDetection: () => {}, onAiStatus: () => {},
    onAiPrediction: (prediction) => { predictionId = prediction.id; },
    onInterrupted: () => { interrupted += 1; },
    onReconnected: () => { recovered += 1; },
  };
  const disconnect = new SseLiveFeed().connect(handlers);
  const source = FakeEventSource.instances[0];
  source.emit('open');
  assert.equal(recovered, 0);
  source.emit('ai', JSON.stringify({ id: 123 }));
  assert.equal(predictionId, 123);

  // Browser-managed reconnect: error remains CONNECTING, then the same source opens.
  source.readyState = 0;
  source.emit('error');
  assert.equal(interrupted, 0);
  source.emit('open');
  assert.equal(recovered, 1);

  // An HTTP failure closes EventSource permanently; the adapter retries explicitly.
  source.readyState = FakeEventSource.CLOSED;
  source.emit('error');
  assert.equal(interrupted, 1);
  assert.equal(retries.size, 1);
  const retry = [...retries.values()][0];
  retry();
  const replacement = FakeEventSource.instances[1];
  assert.equal(source.closed, true);
  replacement.emit('open');
  assert.equal(recovered, 2);

  disconnect();
  assert.equal(replacement.closed, true);
  retry();
  assert.equal(FakeEventSource.instances.length, 2);
});
