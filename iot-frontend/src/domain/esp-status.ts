import type { DeviceStatus, Telemetry } from './telemetry.ts';

export const ESP_CURRENT_MS = 30_000;

export interface EspState {
  label: string;
  tone: 'success' | 'danger' | 'neutral';
}

const unknown = (): EspState => ({ label: 'Inconnu', tone: 'neutral' });

// MQTT connectivity describes the broker. Only a recent sample describes the ESP.
export function currentDeviceTelemetry(status: DeviceStatus | null, now: number): Telemetry | null {
  if (!status?.mqttConnected || !status.lastMessageAt) return null;
  const age = now - Date.parse(status.lastMessageAt);
  return Number.isFinite(age) && age >= 0 && age < ESP_CURRENT_MS ? status.telemetry : null;
}

export function espStates(telemetry: Telemetry | null | undefined) {
  const gas: EspState = telemetry?.gasReady === false ? { label: 'Préchauffage', tone: 'neutral' }
    : telemetry?.gasReady !== true || telemetry.gasAlert === undefined ? unknown()
    : telemetry.gasAlert ? { label: 'Alerte gaz', tone: 'danger' } : { label: 'Normal', tone: 'success' };
  const pir: EspState = telemetry?.pirReady === false ? { label: 'Calibration', tone: 'neutral' }
    : telemetry?.pirReady !== true || telemetry.presence === undefined ? unknown()
    : telemetry.presence ? { label: 'Mouvement détecté', tone: 'danger' } : { label: 'Aucun mouvement', tone: 'success' };
  const climate: EspState = telemetry?.climateValid === undefined ? unknown()
    : telemetry.climateValid ? { label: 'Mesure valide', tone: 'success' } : { label: 'Mesure invalide', tone: 'danger' };
  const alarm: EspState = telemetry?.alarmActive === undefined ? unknown()
    : telemetry.alarmActive ? { label: 'Active', tone: 'danger' } : { label: 'Inactive', tone: 'success' };
  const led = (value: boolean | undefined): EspState => value === undefined ? unknown()
    : { label: value ? 'Allumée' : 'Éteinte', tone: 'neutral' };
  return { gas, pir, climate, alarm, ledRed: led(telemetry?.ledRed),
    ledOrange: led(telemetry?.ledOrange), ledGreen: led(telemetry?.ledGreen) };
}
