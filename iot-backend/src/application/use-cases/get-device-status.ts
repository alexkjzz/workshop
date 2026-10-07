import type { DeviceStatus } from '../../domain/telemetry.js';
import type { DeviceState } from '../device-state.js';
import type { DeviceGateway } from '../ports.js';

export class GetDeviceStatus {
  constructor(
    private readonly state: DeviceState,
    private readonly gateway: DeviceGateway,
  ) {}

  execute(): DeviceStatus {
    return { mqttConnected: this.gateway.isConnected(), ...this.state.latest() };
  }
}
