import { useState, type FormEvent } from 'react';
import { ALERT_TYPES, isValidEmail, type AlertType, type NotificationSettings } from '../../domain/notifications';
import { useNotificationSettings } from '../hooks/useNotificationSettings';
import './SettingsPage.css';

const alertLabels: Record<AlertType, { label: string; hint: string }> = {
  intrusion: { label: 'Intrusion', hint: 'Le capteur de présence détecte quelqu’un.' },
  'unknown-face': { label: 'Visage inconnu', hint: 'La reconnaissance faciale ne reconnaît pas la personne.' },
  'device-offline': { label: 'Boîtier hors ligne', hint: 'Aucune mesure reçue depuis 30 secondes.' },
};

interface NotificationFormProps {
  initial: NotificationSettings;
  busy: boolean;
  onSave: (settings: NotificationSettings) => void;
  onSendTest: () => void;
  onInvalid: (message: string) => void;
}

function NotificationForm({ initial, busy, onSave, onSendTest, onInvalid }: NotificationFormProps) {
  const [email, setEmail] = useState(initial.email ?? '');
  const [enabled, setEnabled] = useState(initial.enabled);
  const [alerts, setAlerts] = useState(initial.alerts);
  const savedEmail = initial.email ?? '';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (address && !isValidEmail(address)) {
      onInvalid('Adresse e-mail invalide.');
      return;
    }
    if (enabled && !address) {
      onInvalid('Renseignez une adresse e-mail pour activer les notifications.');
      return;
    }
    onSave({ email: address || null, enabled, alerts });
  };

  return (
    <form className="settings-form" onSubmit={handleSubmit} noValidate>
      <label className="settings-field">
        Adresse e-mail de réception
        <input
          type="email"
          autoComplete="email"
          placeholder="vous@exemple.fr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="settings-check">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>Activer les notifications par e-mail</span>
      </label>

      <fieldset className="settings-alerts" disabled={!enabled}>
        <legend>Alertes envoyées</legend>
        {ALERT_TYPES.map((type) => (
          <label className="settings-check" key={type}>
            <input
              type="checkbox"
              checked={alerts[type]}
              onChange={(event) => setAlerts((current) => ({ ...current, [type]: event.target.checked }))}
            />
            <span>
              {alertLabels[type].label}
              <small>{alertLabels[type].hint}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="settings-note">Un même type d’alerte est envoyé au plus une fois toutes les 5 minutes.</p>

      <div className="settings-actions">
        <button type="submit" className="settings-primary" disabled={busy}>
          Enregistrer
        </button>
        <button
          type="button"
          className="settings-secondary"
          disabled={busy || !savedEmail || email.trim() !== savedEmail}
          title={!savedEmail ? 'Enregistrez d’abord une adresse' : undefined}
          onClick={onSendTest}
        >
          Envoyer un e-mail de test
        </button>
      </div>
    </form>
  );
}

export function SettingsPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const { settings, mailConfigured, busy, message, save, sendTest } = useNotificationSettings(onSessionExpired);
  const [validationError, setValidationError] = useState('');
  const feedback = validationError ? { text: validationError, error: true } : message;

  return (
    <main className="settings">
      <header className="page-intro">
        <p className="page-eyebrow">Vos préférences</p>
        <h1>Paramètres</h1>
        <p>Choisissez où recevoir les alertes et les événements à surveiller.</p>
      </header>
      <section className="settings-card" aria-labelledby="notifications-title">
        <div className="section-heading">
          <h2 id="notifications-title">Notifications</h2>
          <span>Par e-mail uniquement</span>
        </div>

        {!mailConfigured && (
          <p className="settings-warning" role="note">
            Aucun serveur d’envoi n’est configuré (SMTP) : les e-mails ne partiront pas tant que
            l’administrateur ne l’a pas renseigné.
          </p>
        )}

        {settings ? (
          <NotificationForm
            key={JSON.stringify(settings)}
            initial={settings}
            busy={busy}
            onSave={(next) => {
              setValidationError('');
              void save(next);
            }}
            onSendTest={() => {
              setValidationError('');
              void sendTest();
            }}
            onInvalid={setValidationError}
          />
        ) : (
          <p className="settings-loading">Chargement des paramètres...</p>
        )}

        <p className={`message${feedback?.error ? ' message--error' : ''}`} aria-live="polite">
          {feedback?.text}
        </p>
      </section>
    </main>
  );
}
