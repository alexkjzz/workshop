import assert from 'node:assert/strict';
import test from 'node:test';
import { currentDeviceTelemetry, espStates, ESP_CURRENT_MS } from '../src/domain/esp-status.ts';
import { metricSeries, metricValue, type DeviceStatus, type Reading } from '../src/domain/telemetry.ts';

const timestamp = '2026-10-07T10:00:00.000Z';
const now = Date.parse(timestamp);

test('missing ESP flags never invent a normal state or LEDs', () => {
  for (const telemetry of [null, undefined, {}, { temperature: 23, gas: 123, presence: false }]) {
    for (const state of Object.values(espStates(telemetry))) {
      assert.deepEqual(state, { label: 'Inconnu', tone: 'neutral' });
    }
  }
});

test('warmup and calibration remain distinct from valid zero measurements', () => {
  const warming = { gasReady: false, pirReady: false, climateValid: false,
    gas: 0, presence: false, temperature: 0, humidity: 0 };
  assert.equal(espStates(warming).gas.label, 'Préchauffage');
  assert.equal(espStates(warming).pir.label, 'Calibration');
  assert.equal(espStates(warming).climate.label, 'Mesure invalide');
  for (const metric of ['gas', 'presence', 'temperature', 'humidity'] as const) {
    assert.equal(metricValue(warming, metric), undefined);
  }
  const ready = { ...warming, gasReady: true, pirReady: true, climateValid: true };
  for (const metric of ['gas', 'presence', 'temperature', 'humidity'] as const) {
    assert.equal(metricValue(ready, metric), 0);
  }
});

test('real gas, motion, alarm and LED flags display both active and inactive states', () => {
  const active = espStates({ gasReady: true, gasAlert: true, pirReady: true, presence: true,
    climateValid: true, alarmActive: true, ledRed: true, ledOrange: false, ledGreen: false });
  assert.deepEqual(active.gas, { label: 'Alerte gaz', tone: 'danger' });
  assert.deepEqual(active.pir, { label: 'Mouvement détecté', tone: 'danger' });
  assert.deepEqual(active.alarm, { label: 'Active', tone: 'danger' });
  assert.equal(active.ledRed.label, 'Allumée');
  assert.equal(active.ledOrange.label, 'Éteinte');
  const normal = espStates({ gasReady: true, gasAlert: false, pirReady: true,
    presence: false, alarmActive: false, ledGreen: true });
  assert.deepEqual(normal.gas, { label: 'Normal', tone: 'success' });
  assert.equal(normal.pir.label, 'Aucun mouvement');
  assert.equal(normal.alarm.label, 'Inactive');
  assert.equal(normal.ledGreen.label, 'Allumée');
  assert.equal(espStates({ gasReady: true, pirReady: true }).gas.label, 'Inconnu');
  assert.equal(espStates({ gasReady: true, pirReady: true }).pir.label, 'Inconnu');
});

test('a connected broker cannot make absent, stale or future ESP measurements current', () => {
  const status: DeviceStatus = { mqttConnected: true, lastMessageAt: timestamp,
    telemetry: { gasReady: true, alarmActive: false } };
  assert.equal(currentDeviceTelemetry(status, now), status.telemetry);
  assert.equal(currentDeviceTelemetry(status, now + ESP_CURRENT_MS - 1), status.telemetry);
  assert.equal(currentDeviceTelemetry(status, now + ESP_CURRENT_MS), null);
  assert.equal(currentDeviceTelemetry(status, now - 1), null);
  assert.equal(currentDeviceTelemetry({ ...status, mqttConnected: false }, now), null);
  assert.equal(currentDeviceTelemetry({ ...status, lastMessageAt: null }, now), null);
  assert.equal(currentDeviceTelemetry({ ...status, lastMessageAt: 'invalid' }, now), null);
  assert.equal(currentDeviceTelemetry(null, now), null);
});

test('the four sensor series retain legacy readings and omit invalid warmup samples', () => {
  const readings: Reading[] = [
    { id: 1, recordedAt: timestamp, gasReady: false, pirReady: false, climateValid: false,
      gas: 999, presence: true, temperature: 99, humidity: 99 },
    { id: 2, recordedAt: timestamp, gas: 0, presence: false, temperature: 0, humidity: 0 },
    { id: 3, recordedAt: timestamp, gasReady: true, pirReady: true, climateValid: true,
      gas: 100, presence: true, temperature: 23, humidity: 40 },
  ];
  assert.deepEqual(metricSeries(readings, 'gas').map(({ value }) => value), [0, 100]);
  assert.deepEqual(metricSeries(readings, 'presence').map(({ value }) => value), [0, 1]);
  assert.deepEqual(metricSeries(readings, 'temperature').map(({ value }) => value), [0, 23]);
  assert.deepEqual(metricSeries(readings, 'humidity').map(({ value }) => value), [0, 40]);
  assert.equal(metricValue({ gas: NaN }, 'gas'), undefined);
});
