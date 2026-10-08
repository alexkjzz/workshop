import { useEffect, useState } from 'react';
import { anomalyLabel, currentAiPrediction, currentAiVision, predictionEvents, riskLabel, type AiPrediction, type AiStatus, type VisionStatus } from '../../domain/ai';
import { StatusIndicator } from './StatusIndicator';
import { VisionCamera } from './VisionCamera';
import './AiPanel.css';

interface AiPanelProps {
  status: AiStatus | null;
  predictions: AiPrediction[];
  loadError: string;
  onSessionExpired: () => void;
  onRefresh: () => Promise<void>;
}

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
const visionLabels: Record<VisionStatus, string> = {
  stopped: 'Webcam arrêtée',
  starting: 'Démarrage de la webcam',
  running: 'Webcam en direct',
  unavailable: 'Webcam indisponible',
  error: 'Erreur webcam',
};

function formatTime(timestamp: string | null | undefined): string {
  const time = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(time) ? dateTimeFormat.format(time) : 'Aucune analyse';
}

function confidenceLabel(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)} %`;
}

export function AiPanel({ status, predictions, loadError, onSessionExpired, onRefresh }: AiPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const latest = currentAiPrediction(predictions, now);
  const vision = status?.vision ?? latest?.vision;
  const visionReady = status?.online && currentAiVision(vision, now) !== null;
  const risk = latest?.risk;
  const modelUnavailable = status?.online && !status.model_loaded;
  const reasons = risk?.reasons.length ? risk.reasons : latest?.anomaly.reason ? [latest.anomaly.reason] : [];

  return (
    <section className="ai-panel" aria-labelledby="ai-title">
      <div className="section-heading">
        <h2 id="ai-title">AI ENGINE</h2>
        <StatusIndicator
          tone={status ? status.online ? 'success' : 'danger' : 'neutral'}
          label={status ? status.online ? 'ONLINE' : 'OFFLINE' : 'Connexion...'}
        />
      </div>

      {latest?.source === 'simulation' && <p className="ai-notice">SIMULATION · données de démonstration</p>}
      {status && !status.online && (
        <p className="ai-notice" role="status">
          Service IA indisponible.{latest ? ' La dernière analyse reste consultable ci-dessous.' : ' En attente du service IA.'}
        </p>
      )}
      {modelUnavailable && <p className="ai-notice">Isolation Forest non entraîné · analyse des capteurs indisponible.</p>}
      {risk?.degraded && (
        <p className="ai-notice">Analyse partielle : certaines données ou capacités IA sont indisponibles.</p>
      )}
      {(loadError || status?.last_error) && <p className="ai-error" role="status">{loadError || status?.last_error}</p>}

      <dl className="ai-grid">
        <div className={`ai-metric${latest?.anomaly.is_anomaly ? ' ai-metric--alert' : ''}`}>
          <dt>Anomaly Detection</dt>
          <dd>{anomalyLabel(latest?.anomaly)}</dd>
        </div>
        <div className="ai-metric">
          <dt>Anomaly Score</dt>
          <dd>{latest?.anomaly.anomaly_score == null ? '—' : latest.anomaly.anomaly_score.toFixed(2)}</dd>
        </div>
        <div className="ai-metric">
          <dt>Risk Score</dt>
          <dd>{risk && !(risk.degraded && risk.risk_level === 'SAFE') ? `${risk.risk_score} / 100${risk.degraded ? ' · partiel' : ''}` : '—'}</dd>
        </div>
        <div className={`ai-metric${risk && ['HIGH', 'CRITICAL'].includes(risk.risk_level) ? ' ai-metric--alert' : ''}`}>
          <dt>Risk Level</dt>
          <dd>{riskLabel(risk)}</dd>
        </div>
        <div className="ai-metric">
          <dt>Person Detection</dt>
          <dd>{visionReady && vision ? `${vision.person_count} personne${vision.person_count === 1 ? '' : 's'}` : 'Indisponible'}</dd>
          {visionReady && vision?.person_detected && <small>{vision.confirmed ? 'Présence confirmée' : 'Confirmation en cours'}</small>}
        </div>
        <div className="ai-metric">
          <dt>AI Confidence</dt>
          <dd>{risk ? confidenceLabel(risk.confidence) : '—'}</dd>
          <small>Fusion des capteurs et de la vision</small>
        </div>
      </dl>

      <div className="ai-analysis">
        <p><span>Dernière analyse</span> <time dateTime={latest?.timestamp}>{formatTime(latest?.timestamp)}</time></p>
        {latest?.sensor_timestamp && <p><span>Mesure analysée</span> <time dateTime={latest.sensor_timestamp}>{formatTime(latest.sensor_timestamp)}</time></p>}
        <p><span>Type de menace</span> {risk ? risk.degraded && risk.category === 'SAFE' ? 'Indéterminé' : risk.category : '—'}</p>
        {reasons.length > 0 && (
          <ul className="ai-reasons" aria-label="Raisons de l’analyse">
            {reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
          </ul>
        )}
        {latest?.anomaly.missing_fields.length ? (
          <p className="ai-notice">Capteurs manquants : {latest.anomaly.missing_fields.join(', ')}.</p>
        ) : null}
      </div>

      <div className="ai-vision">
        <h3>Webcam du serveur local</h3>
        <p className="ai-vision-state">{vision ? visionLabels[vision.status] : 'En attente du service IA'}</p>
        {vision?.error && <p className="ai-error">{vision.error}</p>}
        <VisionCamera status={status} onSessionExpired={onSessionExpired} onRefresh={onRefresh} />
        <dl className="ai-performance">
          <div><dt>Confiance vision</dt><dd>{visionReady && vision ? confidenceLabel(vision.max_confidence) : '—'}</dd></div>
          <div><dt>FPS</dt><dd>{visionReady && vision ? vision.fps.toFixed(1) : '—'}</dd></div>
          <div><dt>Inférence</dt><dd>{visionReady && vision ? `${vision.inference_time_ms.toFixed(1)} ms` : '—'}</dd></div>
        </dl>
        {vision?.last_prediction_time && <p className="ai-frame-time">Dernière détection : {formatTime(vision.last_prediction_time)}</p>}
      </div>

      <div className="ai-events">
        <h3>Événements IA récents</h3>
        <div className="history">
          <table>
            <caption className="visually-hidden">Historique des analyses IA</caption>
            <thead><tr><th scope="col">Détection</th><th scope="col">Événement / raison</th><th scope="col">Risque</th></tr></thead>
            <tbody>
              {predictions.slice(0, 20).map((prediction) => (
                <tr key={prediction.id}>
                  <td>
                    <time dateTime={prediction.timestamp}>{formatTime(prediction.timestamp)}</time>
                    {prediction.source === 'simulation' && <small>SIMULATION</small>}
                  </td>
                  <td>
                    {predictionEvents(prediction).join(' · ')}
                    <small>{prediction.risk.category === 'SAFE' && prediction.risk.degraded ? 'Indéterminé' : prediction.risk.category}</small>
                    <small>{prediction.risk.reasons.join(' · ') || prediction.anomaly.reason}</small>
                  </td>
                  <td>{riskLabel(prediction.risk)}</td>
                </tr>
              ))}
              {predictions.length === 0 && <tr><td colSpan={3}>Aucun événement IA enregistré</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {status && (status.queue_depth > 0 || status.dropped_samples > 0) && (
        <p className="ai-notice">Mesures en attente : {status.queue_depth} · mesures ignorées : {status.dropped_samples}.</p>
      )}
    </section>
  );
}
