import './DeviceDashboard.css';
import type { DeviceCommand, DeviceStatus } from '../types';

interface DeviceDashboardProps {
  status: DeviceStatus | null;
  loading: boolean;
  loadError: string;
  commandMessage: string;
  sendingCommand: boolean;
  sendCommand: (order: DeviceCommand) => Promise<void>;
}

function formatReading(value: number | boolean | undefined, unit = '') {
  if (value === undefined) return 'Aucune donnée';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return `${value}${unit}`;
}

export function DeviceDashboard({
  status,
  loading,
  loadError,
  commandMessage,
  sendingCommand,
  sendCommand,
}: DeviceDashboardProps) {
  const telemetry = status?.telemetry;
  const lastMessage = status?.lastMessageAt
    ? new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' }).format(
        new Date(status.lastMessageAt),
      )
    : 'Aucun message reçu';

  return (
    <main className="dashboard">
      <header className="page-header">
        <p className="connection-status" role="status">
          {loading
            ? 'Connexion au serveur...'
            : status?.mqttConnected
              ? 'Broker MQTT connecté'
              : 'Broker MQTT déconnecté'}
        </p>
      </header>

      <section className="readings" aria-labelledby="readings-title">
        <div className="section-heading">
          <h2 id="readings-title">Capteurs</h2>
          <span>Dernier message : {lastMessage}</span>
        </div>
        <dl className="reading-grid">
          <div className="reading">
            <dt>Température</dt>
            <dd>{formatReading(telemetry?.temperature, ' °C')}</dd>
          </div>
          <div className="reading">
            <dt>Humidité</dt>
            <dd>{formatReading(telemetry?.humidity, ' %')}</dd>
          </div>
          <div className="reading">
            <dt>Gaz</dt>
            <dd>{formatReading(telemetry?.gas)}</dd>
          </div>
          <div className="reading">
            <dt>Présence</dt>
            <dd>{formatReading(telemetry?.presence)}</dd>
          </div>
        </dl>
      </section>

      <section className="commands" aria-labelledby="commands-title">
        <h2 id="commands-title">Commande LED</h2>
        <div className="command-buttons">
          <button
            type="button"
            disabled={!status?.mqttConnected || sendingCommand}
            onClick={() => void sendCommand('ON')}
          >
            Allumer
          </button>
          <button
            type="button"
            disabled={!status?.mqttConnected || sendingCommand}
            onClick={() => void sendCommand('OFF')}
          >
            Éteindre
          </button>
        </div>
        <p className="message" aria-live="polite">{loadError || commandMessage}</p>
      </section>
    </main>
  );
}