import { useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import type { NotificationSettings } from '../../domain/notifications';
import { useServices } from '../services-context';

export function useNotificationSettings(onSessionExpired: () => void) {
  const { settingsApi } = useServices();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [mailConfigured, setMailConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const sessionExpiredRef = useRef(onSessionExpired);

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired;
  });

  const handleError = (error: unknown) => {
    if (error instanceof UnauthorizedError) sessionExpiredRef.current();
    else setMessage({ text: error instanceof Error ? error.message : 'Erreur de connexion.', error: true });
  };

  useEffect(() => {
    let active = true;
    settingsApi.getNotificationSettings().then(
      (view) => {
        if (!active) return;
        setSettings(view.settings);
        setMailConfigured(view.mailConfigured);
      },
      (error: unknown) => {
        if (active) handleError(error);
      },
    );
    return () => {
      active = false;
    };
  }, [settingsApi]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await action(), error: false });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const save = (next: NotificationSettings) =>
    run(async () => {
      const view = await settingsApi.saveNotificationSettings(next);
      setSettings(view.settings);
      setMailConfigured(view.mailConfigured);
      return 'Paramètres enregistrés.';
    });

  const sendTest = () => run(() => settingsApi.sendTestNotification());

  return { settings, mailConfigured, busy, message, save, sendTest };
}
