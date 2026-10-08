import { espStates } from '../../domain/esp-status';
import type { Telemetry } from '../../domain/telemetry';
import { StatusIndicator } from './StatusIndicator';
import './EspStatusPanel.css';

export function EspStatusPanel({ telemetry, message }: { telemetry: Telemetry | null; message: string }) {
  const state = espStates(telemetry);
  const rows = [
    ['Gaz MQ-2', state.gas], ['Présence PIR', state.pir], ['DHT22', state.climate],
    ['Alarme locale', state.alarm], ['LED rouge', state.ledRed],
    ['LED orange', state.ledOrange], ['LED verte', state.ledGreen],
  ] as const;

  return (
    <section className="esp-status" aria-labelledby="esp-status-title">
      <div className="section-heading">
        <h2 id="esp-status-title">État du boîtier ESP</h2>
        <span>{telemetry ? 'Dernières mesures reçues' : 'État indisponible'}</span>
      </div>
      {message && <p className="esp-status-message" role="status">{message}</p>}
      <dl className="esp-status-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd><StatusIndicator tone={value.tone} label={value.label} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
