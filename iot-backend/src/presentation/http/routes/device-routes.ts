import { Router } from 'express';
import type { GetDeviceStatus } from '../../../application/use-cases/get-device-status.js';
import type { SendDeviceCommand } from '../../../application/use-cases/send-device-command.js';
import { currentSession } from '../middleware/require-session.js';

export function deviceRoutes(getDeviceStatus: GetDeviceStatus, sendDeviceCommand: SendDeviceCommand) {
  const router = Router();

  router.get('/status', (_request, response) => {
    response.json(getDeviceStatus.execute());
  });

  router.post('/action', async (request, response) => {
    const body: unknown = request.body;
    const order = typeof body === 'object' && body !== null && 'ordre' in body ? body.ordre : undefined;
    const command = await sendDeviceCommand.execute(order);
    console.info(`Command ${command} sent by ${currentSession(response).userEmail}.`);
    response.status(202).json({ message: `Command ${command} published.` });
  });

  return router;
}
