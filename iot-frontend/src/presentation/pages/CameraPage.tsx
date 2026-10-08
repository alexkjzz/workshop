import { useEffect, useState } from 'react';
import { currentAiVision, personDetectionHistory, personDetectionLabel, type AiPrediction, type AiStatus } from '../../domain/ai';
import { currentDetection, hasUnknownFace, type Face, type VisionDetection } from '../../domain/vision';
import { VisionCamera } from '../components/VisionCamera';
import { FaceRecognitionPanel } from '../components/FaceRecognitionPanel';
import './CameraPage.css';

const TABLE_ROWS = 20;

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });

function describeFaces(faces: Face[]) {
  if (faces.length === 0) return 'Aucun visage';
  return faces
    .map((face) => `${face.name ?? 'Inconnu'} (${Math.round(face.confidence * 100)} %)`)
    .join(', ');
}

function personsLabel(count: number) {
  return count <= 1 ? `${count} personne` : `${count} personnes`;
}

interface CameraPageProps {
  detections: VisionDetection[];
  aiPredictions: AiPrediction[];
  aiStatus: AiStatus | null;
  refreshAi: () => Promise<void>;
  onSessionExpired: () => void;
}

export function CameraPage({ detections, aiPredictions, aiStatus, refreshAi, onSessionExpired }: CameraPageProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    // A new SSE result can be newer than the last one-second clock tick.
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    return () => window.cancelAnimationFrame(frame);
  }, [aiStatus]);

  const latest = detections[0];
  const current = currentDetection(detections, now);
  const unknownFace = hasUnknownFace(current);
  const currentVision = aiStatus?.online ? currentAiVision(aiStatus.vision, now) : null;
  const personHistory = personDetectionHistory(aiPredictions).slice(0, TABLE_ROWS);

  return (
    <main className="camera" aria-labelledby="camera-page-title">
      <header className="page-intro">
        <p className="page-eyebrow">Surveillance visuelle</p>
        <h1 id="camera-page-title">Caméra</h1>
        <p>Suivez le flux vidéo, les personnes détectées et les reconnaissances faciales.</p>
      </header>
      <div className="camera-layout">
        <div className="camera-primary">
          <section className="camera-monitor" aria-labelledby="camera-title">
            <div className="section-heading">
              <h2 id="camera-title">Flux vidéo</h2>
              <span>Webcam du serveur local</span>
            </div>
            <VisionCamera status={aiStatus} onSessionExpired={onSessionExpired} onRefresh={refreshAi} />
            {currentVision && (
              <p className="camera-ai-summary" role="status">
                YOLO : {personsLabel(currentVision.person_count)} · {Math.round(currentVision.max_confidence * 100)} %
                {currentVision.person_detected ? currentVision.confirmed ? ' · présence confirmée' : ' · confirmation en cours' : ''}
                {' · '}{currentVision.fps.toFixed(1)} FPS · {currentVision.inference_time_ms.toFixed(1)} ms
              </p>
            )}
            {aiStatus?.vision?.error && <p className="camera-ai-error">{aiStatus.vision.error}</p>}
          </section>

          <section className="detection person-detection" aria-labelledby="person-detection-title">
            <div className="section-heading">
              <h2 id="person-detection-title">Détection de personnes</h2>
              <span>YOLO · webcam du serveur</span>
            </div>
            <p className={`detection-current person-detection-current${currentVision?.confirmed ? ' detection-current--alert' : ''}`} role="status">
              {personDetectionLabel(aiStatus, now)}
            </p>
            <h3 className="camera-history-heading">Historique des analyses</h3>
            <div className="history">
              <table>
                <caption className="visually-hidden">Historique des analyses YOLO</caption>
                <thead>
                  <tr>
                    <th scope="col">Heure</th>
                    <th scope="col">Personnes</th>
                    <th scope="col">Confiance</th>
                    <th scope="col">Confirmation</th>
                  </tr>
                </thead>
                <tbody>
                  {personHistory.map((vision) => (
                    <tr key={vision.last_prediction_time}>
                      <td>{timeFormat.format(Date.parse(vision.last_prediction_time!))}</td>
                      <td>{vision.person_count}</td>
                      <td>{vision.person_count > 0 ? `${Math.round(vision.max_confidence * 100)} %` : '—'}</td>
                      <td>{vision.person_count === 0 ? 'Aucune présence' : vision.confirmed ? 'Confirmée' : 'En cours'}</td>
                    </tr>
                  ))}
                  {personHistory.length === 0 && (
                    <tr><td colSpan={4}>Aucune analyse de personnes reçue.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <FaceRecognitionPanel status={aiStatus} now={now} onRefresh={refreshAi} onSessionExpired={onSessionExpired} />
      </div>

      {latest && <section className="detection external-facial-detection" aria-labelledby="detection-title">
        <div className="section-heading">
          <h2 id="detection-title">Résultats du service facial externe</h2>
          <span>{latest ? `Dernier résultat : ${timeFormat.format(Date.parse(latest.detectedAt))}` : 'En attente de résultats'}</span>
        </div>
        <p className={`detection-current${unknownFace ? ' detection-current--alert' : ''}`} role="status">
          {current
            ? current.persons > 0
              ? `${personsLabel(current.persons)} · ${describeFaces(current.faces)}`
              : 'Aucun visage détecté lors de la dernière analyse.'
            : latest
              ? 'Les résultats de reconnaissance faciale ne sont plus à jour.'
              : 'Aucune donnée de reconnaissance faciale reçue.'}
        </p>

        <div className="history">
          <table>
            <caption className="visually-hidden">Historique de la reconnaissance faciale</caption>
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Personnes</th>
                <th scope="col">Visages</th>
              </tr>
            </thead>
            <tbody>
              {detections.slice(0, TABLE_ROWS).map((detection) => (
                <tr key={detection.detectedAt}>
                  <td>{timeFormat.format(Date.parse(detection.detectedAt))}</td>
                  <td>{detection.persons}</td>
                  <td>{describeFaces(detection.faces)}</td>
                </tr>
              ))}
              {detections.length === 0 && (
                <tr>
                  <td colSpan={3}>Aucun résultat de reconnaissance faciale reçu.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>}
    </main>
  );
}
