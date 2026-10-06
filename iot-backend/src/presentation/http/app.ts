import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import express from 'express';
import type { CameraFeed, LiveEvents, SessionVerifier } from '../../application/ports.js';
import type { GetDeviceStatus } from '../../application/use-cases/get-device-status.js';
import type { GetReadingHistory } from '../../application/use-cases/get-reading-history.js';
import type { GetRecentDetections } from '../../application/use-cases/get-recent-detections.js';
import type {
  GetNotificationSettings,
  SendTestNotification,
  UpdateNotificationSettings,
} from '../../application/use-cases/notification-settings.js';
import type { SendDeviceCommand } from '../../application/use-cases/send-device-command.js';
import { normalizeClientIp } from './middleware/client-ip.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireSession } from './middleware/require-session.js';
import { deviceRoutes } from './routes/device-routes.js';
import { liveRoutes } from './routes/live-routes.js';
import { readingRoutes } from './routes/reading-routes.js';
import { settingsRoutes } from './routes/settings-routes.js';
import { visionRoutes } from './routes/vision-routes.js';

export interface HttpDependencies {
  useCases: {
    getDeviceStatus: GetDeviceStatus;
    getReadingHistory: GetReadingHistory;
    getRecentDetections: GetRecentDetections;
    sendDeviceCommand: SendDeviceCommand;
    getNotificationSettings: GetNotificationSettings;
    updateNotificationSettings: UpdateNotificationSettings;
    sendTestNotification: SendTestNotification;
  };
  liveEvents: LiveEvents;
  cameraFeed: CameraFeed;
  sessions: SessionVerifier;
  authHandler: (request: IncomingMessage, response: ServerResponse) => unknown;
  frontendOrigins: string[];
  trustProxy: string;
}

export function createHttpApp({
  useCases,
  liveEvents,
  cameraFeed,
  sessions,
  authHandler,
  frontendOrigins,
  trustProxy,
}: HttpDependencies) {
  const app = express();

  app.set('trust proxy', trustProxy);
  app.use(normalizeClientIp);
  app.use(cors({ origin: frontendOrigins, credentials: true }));

  // Better Auth must receive the raw body, before express.json().
  app.all('/api/auth/*splat', authHandler);
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  const protectedApi = express.Router();
  protectedApi.use(requireSession(sessions));
  protectedApi.use(deviceRoutes(useCases.getDeviceStatus, useCases.sendDeviceCommand));
  protectedApi.use(readingRoutes(useCases.getReadingHistory));
  protectedApi.use(visionRoutes(useCases.getRecentDetections, cameraFeed));
  protectedApi.use(liveRoutes(liveEvents));
  protectedApi.use(
    settingsRoutes(
      useCases.getNotificationSettings,
      useCases.updateNotificationSettings,
      useCases.sendTestNotification,
    ),
  );
  app.use('/api', protectedApi);

  app.use(errorHandler);
  return app;
}
