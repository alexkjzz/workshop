import mqtt, { type MqttClient } from 'mqtt';
import { parseTelemetry, type DeviceStatus } from './telemetry.js';

export class MqttService {
  private readonly client: MqttClient;
  private connected = false;
  private lastMessageAt: string | null = null;
  private telemetry: DeviceStatus['telemetry'] = null;

  constructor(
    url: string,
    private readonly telemetryTopic: string,
    private readonly commandTopic: string,
  ) {
    this.client = mqtt.connect(url, { reconnectPeriod: 1000, connectTimeout: 10000 });

    this.client.on('connect', () => {
      this.connected = true;
      console.info('Connected to MQTT broker.');
      this.client.subscribe(this.telemetryTopic, { qos: 1 }, (error) => {
        if (error) {
          console.error('Could not subscribe to telemetry topic.', error.message);
        }
      });
    });

    this.client.on('close', () => {
      this.connected = false;
      console.warn('MQTT connection closed.');
    });

    this.client.on('error', (error) => {
      console.error('MQTT connection error.', error.message);
    });

    this.client.on('message', (topic, message) => {
      if (topic !== this.telemetryTopic) {
        return;
      }

      const telemetry = parseTelemetry(message.toString());
      if (!telemetry) {
        console.warn('Ignored invalid telemetry message.');
        return;
      }

      this.telemetry = telemetry;
      this.lastMessageAt = new Date().toISOString();
    });
  }

  getStatus(): DeviceStatus {
    return {
      mqttConnected: this.connected,
      lastMessageAt: this.lastMessageAt,
      telemetry: this.telemetry,
    };
  }

  publishCommand(order: 'ON' | 'OFF'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(this.commandTopic, order, { qos: 1 }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.client.end(false, {}, () => resolve());
    });
  }
}