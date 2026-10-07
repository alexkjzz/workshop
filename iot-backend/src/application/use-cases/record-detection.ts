import type { VisionDetection } from '../../domain/vision.js';
import type { DeviceState } from '../device-state.js';
import type { LiveEvents } from '../ports.js';

export class RecordDetection {
  constructor(
    private readonly state: DeviceState,
    private readonly events: LiveEvents,
  ) {}

  execute(detection: VisionDetection) {
    this.state.addDetection(detection);
    this.events.publish({ type: 'vision', detection });
  }
}
