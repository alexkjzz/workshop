import { useEffect, useRef, useState } from 'react';
import { UnauthorizedError } from '../../application/errors';
import type { AiStatus } from '../../domain/ai';
import { faceEnrollmentUnavailable } from '../../domain/face-enrollment';
import { currentFaces, faceRecognitionLabel, type FaceEnrollmentResponse, type FaceRecognitionResult } from '../../domain/faces';
import { useServices } from '../services-context';
import { FaceEnrollmentForm } from './FaceEnrollmentForm';
import './FaceRecognitionPanel.css';

const timeFormat = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' });
const time = (value: string) => timeFormat.format(Date.parse(value));

interface Props {
  status: AiStatus | null;
  now: number;
  onRefresh: () => Promise<void>;
  onSessionExpired: () => void;
}

export function FaceRecognitionPanel({ status, now, onRefresh, onSessionExpired }: Props) {
  const { aiApi } = useServices();
  const [reloaded, setReloaded] = useState<FaceRecognitionResult | null>(null);
  const [busy, setBusy] = useState<'reload' | 'enroll' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const live = status?.vision?.faces;
  const result = reloaded && (!live || Date.parse(reloaded.timestamp) > Date.parse(live.timestamp)) ? reloaded : live;
  const moduleMissing = status?.online && !!status.vision && !result;
  const faces = status?.online && status.vision?.status === 'running' ? currentFaces(result, now) ?? [] : [];

  async function reload() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy('reload');
    setError(null);
    try {
      const loaded = await aiApi.reloadFaces(controller.signal);
      if (controller.signal.aborted) return;
      setReloaded(loaded);
      setError(loaded.reload_error);
      await onRefresh();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof UnauthorizedError) onSessionExpired();
      else setError(failure instanceof Error ? failure.message : 'Rechargement indisponible.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function enroll(name: string, files: File[]): Promise<FaceEnrollmentResponse | null> {
    if (request.current || faceEnrollmentUnavailable(status, result)) return null;
    const controller = new AbortController();
    request.current = controller;
    setBusy('enroll');
    setError(null);
    try {
      const response = await aiApi.enrollFaces(name, files, controller.signal);
      if (controller.signal.aborted) return null;
      setReloaded(response.catalog);
      setError(response.catalog.reload_error);
      await onRefresh();
      return controller.signal.aborted ? null : response;
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof UnauthorizedError) onSessionExpired();
        else setError(failure instanceof Error ? failure.message : 'Ajout des photos indisponible.');
      }
      return null;
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return (
    <section className="detection facial-detection" aria-labelledby="face-recognition-title">
      <div className="section-heading">
        <h2 id="face-recognition-title">Reconnaissance faciale</h2>
        <span>YuNet · SFace</span>
      </div>
      <p className="detection-current" role="status">{faceRecognitionLabel(status, result, now)}</p>
      <div className="face-catalog">
        <p>{result ? <><strong>{result.known_identities}</strong> identité(s) connue(s) · <strong>{result.reference_images}</strong> photo(s) de référence</> : moduleMissing ? 'Catalogue facial indisponible' : 'Catalogue en attente'}</p>
        <button type="button" onClick={() => void reload()} disabled={!status?.online || moduleMissing || result?.enabled === false || busy !== null || result?.reloading}>
          {busy === 'reload' || result?.reloading ? 'Rechargement…' : 'Recharger les visages connus'}
        </button>
      </div>
      {result?.model_loaded && result.known_identities === 0 && (
        <p className="camera-ai-summary">Ajoutez une personne avec le formulaire ci-dessous. Les visages non enregistrés apparaîtront comme Inconnu.</p>
      )}
      {!!result?.skipped_images && <p className="camera-ai-summary">{result.skipped_images} photo(s) ignorée(s) : consultez les logs du service IA.</p>}
      {(error || result?.error || result?.reload_error) && <p className="camera-ai-error" role="alert">{error || result?.error || result?.reload_error}</p>}
      <div className="face-cards">
        {faces.map((face) => (
          <article className="face-recognition-card" data-known={face.known} key={face.face_id}>
            <h3>{face.known ? face.name : 'Inconnu'}</h3>
            <span className={face.known ? 'face-known' : 'face-unknown'}>{face.known ? 'Connu' : 'Inconnu'}</span>
            <p>Confiance : {face.similarity === null ? 'Non évaluée' : `${Math.round(face.confidence * 100)} %`}</p>
            {face.tracker_id !== null && <p>Track : #{face.tracker_id}</p>}
            <p>Vu à : {time(face.timestamp)}</p>
            {face.reason && <p className="camera-ai-summary">{face.reason}</p>}
          </article>
        ))}
      </div>
      {faces.length > 0 && <p className="camera-ai-summary">La confiance correspond à la similarité faciale, pas à une probabilité d’identité.</p>}
      <FaceEnrollmentForm busy={busy === 'enroll'}
        disabledReason={busy === 'reload' ? 'Attendez la fin du rechargement du catalogue.' : faceEnrollmentUnavailable(status, result)}
        onEnroll={enroll} />
      <h3 className="camera-history-heading">Dernières reconnaissances</h3>
      <div className="history">
        <table>
          <caption className="visually-hidden">Historique des reconnaissances faciales</caption>
          <thead><tr><th scope="col">Heure</th><th scope="col">Personne</th><th scope="col">Statut</th><th scope="col">Confiance</th><th scope="col">Track</th></tr></thead>
          <tbody>
            {result?.history.slice(0, 20).map((face) => (
              <tr key={`${face.face_id}:${face.timestamp}`}>
                <td>{time(face.timestamp)}</td><td>{face.known ? face.name : 'Inconnu'}</td><td>{face.known ? 'Connu' : 'Inconnu'}</td>
                <td>{face.similarity === null ? '—' : `${Math.round(face.confidence * 100)} %`}</td><td>{face.tracker_id === null ? '—' : `#${face.tracker_id}`}</td>
              </tr>
            ))}
            {!result?.history.length && <tr><td colSpan={5}>Aucune reconnaissance enregistrée.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
