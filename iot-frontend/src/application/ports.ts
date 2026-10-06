import type { NotificationSettings, NotificationSettingsView } from '../domain/notifications';
import type { SignInFailure, UserSession } from '../domain/session';
import type { DeviceCommand, DeviceStatus, Reading } from '../domain/telemetry';
import type { VisionDetection } from '../domain/vision';

// All methods reject with UnauthorizedError when the session has expired.
export interface DeviceApi {
  getStatus(): Promise<DeviceStatus>;
  // Newest first.
  getReadings(limit: number): Promise<Reading[]>;
  getDetections(): Promise<VisionDetection[]>;
  // Resolves with the server's confirmation message.
  sendCommand(command: DeviceCommand): Promise<string>;
  cameraStreamUrl(attempt: number): string;
}

// Rejects with UnauthorizedError when the session has expired, or with the server's message.
export interface SettingsApi {
  getNotificationSettings(): Promise<NotificationSettingsView>;
  saveNotificationSettings(settings: NotificationSettings): Promise<NotificationSettingsView>;
  // Resolves with the server's confirmation message.
  sendTestNotification(): Promise<string>;
}

export interface LiveFeedHandlers {
  onReading(reading: Reading): void;
  onDetection(detection: VisionDetection): void;
  // The server closed the stream (expired session, restart); it reconnects on its own.
  onInterrupted(): void;
}

export interface LiveFeed {
  // Returns the function that closes the feed.
  connect(handlers: LiveFeedHandlers): () => void;
}

export interface AuthService {
  getSession(): Promise<UserSession | null>;
  // Resolves with the failure reason, or null on success.
  signIn(email: string, password: string): Promise<SignInFailure | null>;
  signOut(): Promise<void>;
}

export type Theme = 'light' | 'dark';

export interface ThemeStore {
  // null when the user never chose: the system theme applies.
  load(): Theme | null;
  save(theme: Theme): void;
}

export interface Services {
  deviceApi: DeviceApi;
  settingsApi: SettingsApi;
  liveFeed: LiveFeed;
  auth: AuthService;
  themeStore: ThemeStore;
}
