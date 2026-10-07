import { isDeviceCommand, type DeviceCommand } from '../../domain/telemetry.js';
import { CommandDeliveryError, DeviceUnavailableError, InvalidRequestError } from '../errors.js';
import type { DeviceGateway } from '../ports.js';

export class SendDeviceCommand {
  constructor(private readonly gateway: DeviceGateway) {}

  async execute(command: unknown): Promise<DeviceCommand> {
    if (!isDeviceCommand(command)) {
      throw new InvalidRequestError("Invalid command. Use 'ON' or 'OFF'.");
    }
    if (!this.gateway.isConnected()) {
      throw new DeviceUnavailableError('MQTT broker is not connected.');
    }
    try {
      await this.gateway.sendCommand(command);
    } catch {
      throw new CommandDeliveryError('Could not publish command to MQTT.');
    }
    return command;
  }
}
