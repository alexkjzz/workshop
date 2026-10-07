import type { NotificationSettings } from '../domain/notification.js';
import type { DeviceCommand, Reading, Telemetry } from '../domain/telemetry.js';
import type { VisionDetection } from '../domain/vision.js';
import type { FaceHistory, FaceLatest, FaceRecognitionResult } from '../domain/faces.js';
import type { AiPrediction, AiSensorSample, AiServiceStatus, AiSource, AiStatus, StoredAiPrediction, VisionResult } from '../domain/ai.js';

export interface ReadingRepository {
  save(telemetry: Telemetry, recordedAt: Date, source?: AiSource): Reading;
  // Most recent readings, newest first.
  findRecent(limit: number): Reading[];
  deleteOlderThan(date: Date): number;
}

export interface DeviceGateway {
  isConnected(): boolean;
  sendCommand(command: DeviceCommand): Promise<void>;
}

export type LiveEvent =
  | { type: 'reading'; reading: Reading; source?: AiSource }
  | { type: 'vision'; detection: VisionDetection }
  | { type: 'ai'; prediction: StoredAiPrediction }
  | { type: 'ai-status'; status: AiStatus };

export interface AiGateway {
  isConfigured(): boolean;
  analyze(sample: AiSensorSample): Promise<AiPrediction>;
  status(): Promise<AiServiceStatus>;
  visionStatus?(): Promise<VisionResult>;
  facesStatus?(): Promise<FaceRecognitionResult>;
  facesLatest?(): Promise<FaceLatest>;
  facesHistory?(): Promise<FaceHistory>;
  reloadFaces?(): Promise<FaceRecognitionResult>;
  controlVision(action: 'start' | 'stop'): Promise<VisionResult>;
}

export interface AiPredictionRepository {
  save(prediction: AiPrediction): StoredAiPrediction;
  findRecent(limit: number): StoredAiPrediction[];
  deleteOlderThan(date: Date): number;
}

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
