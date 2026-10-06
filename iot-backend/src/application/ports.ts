import type { NotificationSettings } from '../domain/notification.js';
import type { DeviceCommand, Reading, Telemetry } from '../domain/telemetry.js';
import type { VisionDetection } from '../domain/vision.js';

export interface ReadingRepository {
  save(telemetry: Telemetry, recordedAt: Date): Reading;
  // Most recent readings, newest first.
  findRecent(limit: number): Reading[];
  deleteOlderThan(date: Date): number;
}

export interface DeviceGateway {
  isConnected(): boolean;
  sendCommand(command: DeviceCommand): Promise<void>;
}

export type LiveEvent =
  | { type: 'reading'; reading: Reading }
  | { type: 'vision'; detection: VisionDetection };

export interface LiveEvents {
  publish(event: LiveEvent): void;
  // Returns the unsubscribe function.
  subscribe(listener: (event: LiveEvent) => void): () => void;
}

export interface CameraStream {
  contentType: string;
  body: ReadableStream<Uint8Array>;
}

export interface CameraFeed {
  isConfigured(): boolean;
  // null when the vision service is unreachable.
  open(signal: AbortSignal): Promise<CameraStream | null>;
}

export interface Session {
  userName: string;
  userEmail: string;
  expiresAt: Date;
}

export interface SessionVerifier {
  verify(headers: Headers): Promise<Session | null>;
}

export interface Clock {
  now(): Date;
}

export interface NotificationSettingsRepository {
  get(): NotificationSettings;
  save(settings: NotificationSettings): void;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  isConfigured(): boolean;
  send(message: MailMessage): Promise<void>;
}
