import { metricSeries, metricValue, type DeviceCommand, type DeviceStatus, type Reading } from '../../domain/telemetry';
import { LineChart } from '../components/LineChart';
import { StatusIndicator } from '../components/StatusIndicator';
import { metricViews, type MetricView } from '../metrics';
import './MetricsPage.css';

// Rows shown in each history table (the charts use the whole loaded history).
const TABLE_ROWS = 20;

interface MetricsPageProps {
  status: DeviceStatus | null;
  readings: Reading[];
  loading: boolean;
  loadError: string;
  commandMessage: string;
  sendingCommand: boolean;
  sendCommand: (order: DeviceCommand) => Promise<void>;
}

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });

function MetricHistory({ metric, readings }: { metric: MetricView; readings: Reading[] }) {
  const points = metricSeries(readings, metric.key);
  const rows = points.slice(-TABLE_ROWS).reverse();

  return (
    <>
      <LineChart points={points} label={metric.label} formatValue={metric.format} steps={metric.steps} />
      <div className="history">
        <table>
          <caption className="visually-hidden">Valeurs précédentes : {metric.label}</caption>
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Valeur</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.time}-${index}`}>
                <td>{timeFormat.format(row.time)}</td>
                <td>{metric.format(row.value)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2}>Aucune valeur enregistrée</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function MetricsPage({
  status,
  readings,
  loading,
  loadError,
  commandMessage,
  sendingCommand,
  sendCommand,
}: MetricsPageProps) {
  const telemetry = status?.telemetry;
  const lastMessage = status?.lastMessageAt
    ? timeFormat.format(new Date(status.lastMessageAt))
    : 'Aucun message reçu';

  return (
    <main className="dashboard">
      <header className="page-header">
        {loading ? (
          <StatusIndicator tone="neutral" label="Connexion au serveur..." />
        ) : status?.mqttConnected ? (
          <StatusIndicator tone="success" label="Broker MQTT connecté" />
        ) : (
          <StatusIndicator tone="danger" label="Broker MQTT déconnecté" />
        )}
      </header>

      <section className="readings" aria-labelledby="readings-title">
        <div className="section-heading">
          <h2 id="readings-title">Capteurs</h2>
          <span>Dernier message : {lastMessage}</span>
        </div>
        <dl className="reading-grid">
          {metricViews.map((metric) => {
            const value = metricValue(telemetry, metric.key);
            return (
              <div className="reading" key={metric.key}>
                <dt>{metric.label}</dt>
                <dd>{value === undefined ? 'Aucune donnée' : metric.format(value)}</dd>
                <MetricHistory metric={metric} readings={readings} />
              </div>
            );
          })}
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
