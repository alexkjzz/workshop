import type { LiveEvent, LiveEvents } from '../../application/ports.js';

export class InMemoryLiveEvents implements LiveEvents {
  private readonly listeners = new Set<(event: LiveEvent) => void>();

  publish(event: LiveEvent) {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: LiveEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
