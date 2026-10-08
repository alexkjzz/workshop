import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FACE_MAX_FILES, validateFaceEnrollment } from '../../domain/face-enrollment';
import type { FaceEnrollmentResponse } from '../../domain/faces';

interface Props {
  busy: boolean;
  disabledReason: string | null;
  onEnroll: (name: string, files: File[]) => Promise<FaceEnrollmentResponse | null>;
}

function PhotoPreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = image.current;
    if (element) element.src = url;
    return () => {
      element?.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return <img ref={image} alt={`Aperçu de ${file.name}`} />;
}

export function FaceEnrollmentForm({ busy, disabledReason, onEnroll }: Props) {
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState<FaceEnrollmentResponse | null>(null);
  const validation = validateFaceEnrollment(name, files);

  function selectPhotos(selected: FileList | null) {
    if (!selected) return;
    const next = [...files];
    for (const file of Array.from(selected)) {
      if (!next.some((existing) => existing.name === file.name && existing.size === file.size
        && existing.lastModified === file.lastModified)) next.push(file);
    }
    if (next.length > FACE_MAX_FILES) {
      setSelectionError('Vous pouvez sélectionner au maximum 5 photos. Retirez une photo avant d’en ajouter une autre.');
      return;
    }
    setFiles(next);
    setSelectionError(null);
    setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (busy || disabledReason || validation.error || validation.fileErrors.length) return;
    setSelectionError(null);
    setFeedback(null);
    const response = await onEnroll(validation.name, files);
    if (!response) return;
    setFeedback(response);
    if (response.added > 0) {
      // Keep rejected photos selected so a partial success can be corrected.
      const rejected = new Set(response.rejected.map(({ filename }) => filename));
      setFiles((selected) => selected.filter((file) => rejected.has(file.name)));
      setSubmitted(false);
    }
  }

  return (
    <form className="face-enrollment" onSubmit={(event) => void submit(event)} aria-labelledby="face-enrollment-title" aria-busy={busy}>
      <div className="face-enrollment-heading">
        <h3 id="face-enrollment-title">Ajouter une personne</h3>
        <span>Catalogue facial</span>
      </div>
      <p id="face-photo-help" className="camera-ai-summary">
        Une à cinq photos nettes de la même personne, avec un seul visage par photo.
        Trois à cinq photos sont recommandées.
      </p>
      <fieldset disabled={busy || !!disabledReason}>
        <legend className="visually-hidden">Nom et photos de la personne</legend>
        <div className="face-enrollment-inputs">
          <label htmlFor="face-enrollment-name">
            Nom de la personne
            <input id="face-enrollment-name" name="face-name" type="text" value={name} autoComplete="off"
              placeholder="Ex. Mohamed" aria-describedby="face-name-help"
              onChange={(event) => { setName(event.target.value); setFeedback(null); }} />
          </label>
          <label htmlFor="face-enrollment-photos" className="face-photo-picker">
            <span>Photos de référence</span>
            <span className="face-upload-control">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
                <path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="face-upload-label">Choisir des photos<span>JPEG, PNG ou WEBP</span></span>
              <input id="face-enrollment-photos" name="face-photos" type="file" multiple
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-describedby="face-photo-help face-upload-limits"
                onChange={(event) => { selectPhotos(event.target.files); event.target.value = ''; }} />
            </span>
          </label>
        </div>
        <p id="face-name-help" className="camera-ai-summary">64 caractères maximum : lettres, chiffres, espaces, tirets, underscores et apostrophes.</p>
        <p id="face-upload-limits" className="face-upload-limits">5 Mio par photo · 15 Mio par envoi · 4 096 px par côté · 16 mégapixels maximum.</p>
        {files.length > 0 && (
          <ul className="face-photo-selection" aria-label="Photos sélectionnées">
            {files.map((file, index) => {
              const fileError = validation.fileErrors.find((item) => item.index === index);
              return (
                <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                  {!fileError && <PhotoPreview file={file} />}
                  <div>
                    <span className="face-photo-name">{file.name}</span>
                    <span className="camera-ai-summary">{(file.size / 1024 / 1024).toFixed(2)} Mio</span>
                    {fileError && <p className="camera-ai-error">{fileError.message}</p>}
                  </div>
                  <button type="button" aria-label={`Retirer ${file.name}`} onClick={() => {
                    setFiles((selected) => selected.filter((_, selectedIndex) => selectedIndex !== index));
                    setSelectionError(null);
                    setFeedback(null);
                  }}>Retirer</button>
                </li>
              );
            })}
          </ul>
        )}
        {files.length > 0 && <p className="face-selection-summary">{files.length} photo(s) sélectionnée(s) · {(files.reduce((total, file) => total + file.size, 0) / 1024 / 1024).toFixed(2)} Mio</p>}
        {(selectionError || (submitted && validation.error)) && <p className="camera-ai-error" role="alert">{selectionError || validation.error}</p>}
        <button className="face-enroll-submit" type="submit">{busy ? 'Ajout et vérification des photos…' : 'Enregistrer la personne'}</button>
      </fieldset>
      {disabledReason && <p className="camera-ai-summary" role="status">{disabledReason}</p>}
      {busy && <p className="camera-ai-summary" role="status">Envoi des photos et vérification des visages en cours…</p>}
      {feedback && (
        <div className="face-enrollment-feedback" role={feedback.added > 0 ? 'status' : 'alert'}>
          <p>{feedback.added > 0 ? `${feedback.added} photo(s) ajoutée(s) pour ${feedback.name}.` : 'Aucune photo n’a été ajoutée.'}</p>
          {feedback.rejected.length > 0 && (
            <>
              <p>Photos à corriger ou remplacer :</p>
              <ul>{feedback.rejected.map(({ filename, message }, index) => <li key={`${filename}:${index}`}><strong>{filename}</strong> : {message}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </form>
  );
}
