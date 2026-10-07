import type { Clock, ReadingRepository } from '../ports.js';

export class PruneReadingHistory {
  constructor(
    private readonly readings: ReadingRepository,
    private readonly clock: Clock,
    private readonly retentionMs: number,
  ) {}

  // Returns the number of readings removed.
  execute(): number {
    return this.readings.deleteOlderThan(new Date(this.clock.now().getTime() - this.retentionMs));
  }
}
