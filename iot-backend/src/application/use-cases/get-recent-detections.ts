import type { VisionDetection } from '../../domain/vision.js';
import type { DeviceState } from '../device-state.js';

export class GetRecentDetections {
  constructor(private readonly state: DeviceState) {}

  // Newest first.
  execute(): VisionDetection[] {
    return this.state.recentDetections();
  }
}
