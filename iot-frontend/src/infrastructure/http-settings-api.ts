import type { SettingsApi } from '../application/ports';
import type { NotificationSettings, NotificationSettingsView } from '../domain/notifications';
import { jsonBody, requestJson } from './http-client';

const PATH = '/api/settings/notifications';

export class HttpSettingsApi implements SettingsApi {
  getNotificationSettings() {
    return requestJson<NotificationSettingsView>(PATH);
  }

  saveNotificationSettings(settings: NotificationSettings) {
    return requestJson<NotificationSettingsView>(PATH, jsonBody('PUT', settings), "Les paramètres n'ont pas pu être enregistrés.");
  }

  async sendTestNotification() {
    const result = await requestJson<{ message?: string }>(`${PATH}/test`, { method: 'POST' }, "L'e-mail de test n'a pas pu être envoyé.");
    return result.message ?? 'E-mail de test envoyé.';
  }
}
