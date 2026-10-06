import type { Reading } from '../../domain/telemetry.js';
import { InvalidRequestError } from '../errors.js';
import type { ReadingRepository } from '../ports.js';

export const MAX_HISTORY = 500;

export class GetReadingHistory {
  constructor(private readonly readings: ReadingRepository) {}

  // Newest first.
  execute(limit: number): Reading[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY) {
      throw new InvalidRequestError(`limit must be an integer between 1 and ${MAX_HISTORY}.`);
    }
    return this.readings.findRecent(limit);
  }
}
