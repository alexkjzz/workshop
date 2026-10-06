import { useEffect, useState } from 'react';
import { currentDetection, hasUnknownFace, type Face, type VisionDetection } from '../../domain/vision';
import { useServices } from '../services-context';
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

export function CameraPage({ detections }: { detections: VisionDetection[] }) {
  const { deviceApi } = useServices();
  const [streamState, setStreamState] = useState<'loading' | 'live' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = detections[0];
  const current = currentDetection(detections, now);
  const unknownFace = hasUnknownFace(current);

  return (
    <main className="camera">
      <section aria-labelledby="camera-title">
        <div className="section-heading">
          <h2 id="camera-title">Caméra</h2>
          <span>{streamState === 'live' ? 'Flux en direct' : streamState === 'error' ? 'Flux indisponible' : 'Connexion...'}</span>
        </div>
        <div className="camera-frame">
          {streamState !== 'error' && (
            <img
              key={attempt}
              src={deviceApi.cameraStreamUrl(attempt)}
              alt="Flux de la webcam avec la reconnaissance faciale"
              onLoad={() => setStreamState('live')}
              onError={() => setStreamState('error')}
            />
          )}
          {streamState !== 'live' && (
            <div className="camera-placeholder">
              {streamState === 'error' ? (
                <>
                  <p>Le flux de la caméra est indisponible.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setStreamState('loading');
                      setAttempt((value) => value + 1);
                    }}
                  >
                    Réessayer
                  </button>
                </>
              ) : (
                <p>Connexion au flux...</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="detection" aria-labelledby="detection-title">
        <div className="section-heading">
          <h2 id="detection-title">Reconnaissance faciale</h2>
          <span>{latest ? `Dernière détection : ${timeFormat.format(Date.parse(latest.detectedAt))}` : 'Aucune détection'}</span>
        </div>
        <p className={`detection-current${unknownFace ? ' detection-current--alert' : ''}`} role="status">
          {current && current.persons > 0
            ? `${personsLabel(current.persons)} · ${describeFaces(current.faces)}`
            : 'Aucune personne dans le champ de la caméra'}
        </p>

        <div className="history">
          <table>
            <caption className="visually-hidden">Historique des détections</caption>
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
                  <td colSpan={3}>Aucune détection enregistrée</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
