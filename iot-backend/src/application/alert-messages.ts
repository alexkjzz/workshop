import type { Alert, AlertType } from '../domain/notification.js';

const subjects: Record<AlertType, string> = {
  intrusion: 'Intrusion detectee',
  'unknown-face': 'Visage inconnu detecte',
  'device-offline': 'Boitier hors ligne',
};

const descriptions: Record<AlertType, string> = {
  intrusion: 'Le capteur de presence (PIR) du boitier a detecte une presence dans la zone surveillee.',
  'unknown-face': "La reconnaissance faciale a detecte un visage qu'elle ne connait pas.",
  'device-offline': "Le boitier n'envoie plus de mesures : verifier son alimentation et sa liaison Wi-Fi/MQTT.",
};

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });

export function alertMessage(alert: Alert) {
  return {
    subject: `[SENTINEL-X] ${subjects[alert.type]}`,
    text: `${descriptions[alert.type]}\n\nDate : ${dateFormat.format(alert.occurredAt)}\n\nConsulter le centre de commandement pour plus de details.\n`,
  };
}

export function testMessage(now: Date) {
  return {
    subject: '[SENTINEL-X] E-mail de test',
    text: `Les notifications SENTINEL-X sont bien configurees.\n\nEnvoye le ${dateFormat.format(now)}.\n`,
  };
}
