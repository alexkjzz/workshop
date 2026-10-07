import { Router } from 'express';
import type {
  GetNotificationSettings,
  SendTestNotification,
  UpdateNotificationSettings,
} from '../../../application/use-cases/notification-settings.js';
import { currentSession } from '../middleware/require-session.js';

export function settingsRoutes(
  getSettings: GetNotificationSettings,
  updateSettings: UpdateNotificationSettings,
  sendTest: SendTestNotification,
) {
  const router = Router();

  router.get('/settings/notifications', (_request, response) => {
    response.json(getSettings.execute());
  });

  router.put('/settings/notifications', (request, response) => {
    updateSettings.execute(request.body);
    console.info(`Notification settings updated by ${currentSession(response).userEmail}.`);
    response.json(getSettings.execute());
  });

  router.post('/settings/notifications/test', async (_request, response) => {
    const email = await sendTest.execute();
    response.status(202).json({ message: `Test e-mail sent to ${email}.` });
  });

  return router;
}
