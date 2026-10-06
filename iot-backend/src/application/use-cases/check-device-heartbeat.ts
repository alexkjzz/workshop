import type { Alert } from '../../domain/notification.js';
import type { AlertDetector } from '../alert-detector.js';
import type { DeviceState } from '../device-state.js';
import type { Clock } from '../ports.js';

// Raises an alert when the box stops sending measurements.
export class CheckDeviceHeartbeat {
  constructor(
    private readonly state: DeviceState,
    private readonly detector: AlertDetector,
    private readonly clock: Clock,
  ) {}

  execute(): Alert | null {
    return this.detector.fromHeartbeat(this.state.latest().lastMessageAt, this.clock.now());
  }
}
