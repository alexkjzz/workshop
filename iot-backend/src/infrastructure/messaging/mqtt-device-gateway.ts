import mqtt, { type MqttClient } from 'mqtt';
import type { DeviceGateway } from '../../application/ports.js';
import type { DeviceCommand, TelemetryMeasurement } from '../../domain/telemetry.js';
import type { VisionDetection } from '../../domain/vision.js';
import { parseTelemetryMessage, parseVisionMessage } from './messages.js';

export interface MqttTopics {
  telemetry: string;
  command: string;
  vision: string;
}

export interface MqttHandlers {
  onTelemetry(measurement: TelemetryMeasurement): void;
  onDetection(detection: VisionDetection): void;
}

// Talks to the box and the vision service through the MQTT broker.
export class MqttDeviceGateway implements DeviceGateway {
  private readonly client: MqttClient;
  private connected = false;

  constructor(
    url: string,
    private readonly topics: MqttTopics,
    private readonly handlers: MqttHandlers,
  ) {
    this.client = mqtt.connect(url, { reconnectPeriod: 1000, connectTimeout: 10000 });

    this.client.on('connect', () => {
      this.connected = true;
      console.info('Connected to MQTT broker.');
      this.client.subscribe([topics.telemetry, topics.vision], { qos: 1 }, (error) => {
        if (error) console.error('Could not subscribe to MQTT topics.', error.message);
      });
    });
    this.client.on('close', () => {
      this.connected = false;
      console.warn('MQTT connection closed.');
    });
    this.client.on('error', (error) => {
      console.error('MQTT connection error.', error.message);
    });
    this.client.on('message', (topic, payload) => this.route(topic, payload.toString()));
  }

  private route(topic: string, message: string) {
    if (topic === this.topics.telemetry) {
      const measurement = parseTelemetryMessage(message);
      if (measurement) this.handlers.onTelemetry(measurement);
      else console.warn('Ignored invalid telemetry message.');
    } else if (topic === this.topics.vision) {
      const detection = parseVisionMessage(message, new Date());
      if (detection) this.handlers.onDetection(detection);
      else console.warn('Ignored invalid vision message.');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendCommand(command: DeviceCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(this.topics.command, command, { qos: 1 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.client.end(false, {}, () => resolve());
    });
  }
}
