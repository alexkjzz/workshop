import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { MqttService } from './mqtt-service.js';

export function createApp(mqttService: MqttService, frontendOrigins: string[]) {
  const app = express();

  app.use(cors({ origin: frontendOrigins }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/status', (_request, response) => {
    response.json(mqttService.getStatus());
  });

  app.post('/api/action', async (request, response) => {
    const body: unknown = request.body;
    const order =
      typeof body === 'object' && body !== null && 'ordre' in body
        ? body.ordre
        : undefined;

    if (order !== 'ON' && order !== 'OFF') {
      response.status(400).json({ message: "Invalid command. Use 'ON' or 'OFF'." });
      return;
    }

    if (!mqttService.getStatus().mqttConnected) {
      response.status(503).json({ message: 'MQTT broker is not connected.' });
      return;
    }

    try {
      await mqttService.publishCommand(order);
      response.status(202).json({ message: `Command ${order} published.` });
    } catch {
      response.status(502).json({ message: 'Could not publish command to MQTT.' });
    }
  });

  app.use(
    (error: unknown, _request: Request, response: Response, next: NextFunction) => {
      if (response.headersSent) {
        next(error);
        return;
      }

      if (error instanceof SyntaxError) {
        response.status(400).json({ message: 'Request body must be valid JSON.' });
        return;
      }

      console.error('HTTP request failed.', error);
      response.status(500).json({ message: 'Internal server error.' });
    },
  );

  return app;
}