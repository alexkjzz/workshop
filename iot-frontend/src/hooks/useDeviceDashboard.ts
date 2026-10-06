import { useEffect, useRef, useState } from 'react';
import type { DeviceCommand, DeviceStatus } from '../types';

export function useDeviceDashboard(onSessionExpired: () => void) {
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
        const response = await fetch('/api/status');
        if (response.status === 401) {
          sessionExpiredRef.current();
          return;
        }
        if (!response.ok) throw new Error('Impossible de lire le statut du serveur.');
        const nextStatus = (await response.json()) as DeviceStatus;
        if (disposed) return;
        setStatus(nextStatus);
        setLoadError('');
      } catch (error) {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : 'Erreur de connexion.');
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void refreshStatus();
    const intervalId = window.setInterval(() => void refreshStatus(), 2000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const sendCommand = async (order: DeviceCommand) => {
    setSendingCommand(true);
    setCommandMessage('');

    try {
      const response = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordre: order }),
      });
      if (response.status === 401) {
        sessionExpiredRef.current();
        return;
      }
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? 'La commande a échoué.');
      setCommandMessage(result.message ?? 'Commande envoyée.');
    } catch (error) {
      setCommandMessage(error instanceof Error ? error.message : 'Erreur de connexion.');
    } finally {
      setSendingCommand(false);
    }
  };

  return {
    status,
    loading,
    loadError,
    commandMessage,
    sendingCommand,
    sendCommand,
  };
}