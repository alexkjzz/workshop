import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceCommand } from '../../domain/telemetry.js';
import { CommandDeliveryError, DeviceUnavailableError, InvalidRequestError } from '../errors.js';
import { SendDeviceCommand } from './send-device-command.js';

function gateway({ connected = true, fails = false } = {}) {
  const sent: DeviceCommand[] = [];
  return {
    sent,
    isConnected: () => connected,
    sendCommand: async (command: DeviceCommand) => {
      if (fails) throw new Error('broker error');
      sent.push(command);
    },
  };
}

test('sends a valid command', async () => {
  const device = gateway();
  assert.equal(await new SendDeviceCommand(device).execute('ON'), 'ON');
  assert.deepEqual(device.sent, ['ON']);
});

test('rejects invalid commands and unavailable devices', async () => {
  await assert.rejects(new SendDeviceCommand(gateway()).execute('BLINK'), InvalidRequestError);
  await assert.rejects(new SendDeviceCommand(gateway({ connected: false })).execute('ON'), DeviceUnavailableError);
  await assert.rejects(new SendDeviceCommand(gateway({ fails: true })).execute('OFF'), CommandDeliveryError);
});
