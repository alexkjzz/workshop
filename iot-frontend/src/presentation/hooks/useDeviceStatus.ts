import { useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import type { DeviceCommand, DeviceStatus } from '../../domain/telemetry';
import { useServices } from '../services-context';

const REFRESH_MS = 2000;

export function useDeviceStatus(onSessionExpired: () => void) {
  const { deviceApi } = useServices();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [commandMessage, setCommandMessage] = useState('');
  const [sendingCommand, setSendingCommand] = useState(false);
  const sessionExpiredRef = useRef(onSessionExpired);

  useEffect(() => {
    sessionExpiredRef.current = onSessionExpired;
  });

  useEffect(() => {
    let disposed = false;

    const refreshStatus = async () => {
      try {
        const nextStatus = await deviceApi.getStatus();
        if (disposed) return;
        setStatus(nextStatus);
        setLoadError('');
      } catch (error) {
        if (error instanceof UnauthorizedError) sessionExpiredRef.current();
        else if (!disposed) setLoadError(error instanceof Error ? error.message : 'Erreur de connexion.');
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), REFRESH_MS);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [deviceApi]);

  const sendCommand = async (command: DeviceCommand) => {
    setSendingCommand(true);
    setCommandMessage('');
    try {
      setCommandMessage(await deviceApi.sendCommand(command));
    } catch (error) {
      if (error instanceof UnauthorizedError) sessionExpiredRef.current();
      else setCommandMessage(error instanceof Error ? error.message : 'Erreur de connexion.');
    } finally {
      setSendingCommand(false);
    }
  };

  return { status, loading, loadError, commandMessage, sendingCommand, sendCommand };
}
