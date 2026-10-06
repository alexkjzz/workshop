import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Auth } from './auth.js';
import type { MqttService } from './mqtt-service.js';

export function createApp(mqttService: MqttService, auth: Auth, frontendOrigins: string[]) {
  const app = express();

  // Only the local Vite proxy may report the client address. Better Auth reads
  // X-Forwarded-For for rate limiting, so it is rewritten with the real client
  // IP to prevent spoofing.
  app.set('trust proxy', 'loopback');
  app.use((request, _response, next) => {
    request.headers['x-forwarded-for'] = request.ip;
    next();
  });

  app.use(cors({ origin: frontendOrigins, credentials: true }));

  // Better Auth must receive the raw body, before express.json().
  app.all('/api/auth/*splat', toNodeHandler(auth));

  app.use(express.json({ limit: '16kb' }));

  const requireSession: RequestHandler = async (request, response, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }
    response.locals.session = session;
    next();
  };

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/status', requireSession, (_request, response) => {
    response.json(mqttService.getStatus());
  });

  app.post('/api/action', requireSession, async (request, response) => {
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
      console.info(`Command ${order} sent by ${response.locals.session.user.email}.`);
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
