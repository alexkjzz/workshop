import { DEVICE_OFFLINE_AFTER_MS, isRecent, type Alert } from '../domain/notification.js';
import type { LiveEvent } from './ports.js';

// Turns live events and silences into alerts. Only state changes raise an alert.
export class AlertDetector {
  private presence = false;
  private offline = false;

  fromEvent(event: LiveEvent, now: Date): Alert | null {
    if (event.type === 'reading') {
      const { reading } = event;
      // Readings replayed after an outage are history, not a current threat.
      if (!isRecent(reading.recordedAt, now) || reading.presence === undefined) return null;
      const started = reading.presence && !this.presence;
      this.presence = reading.presence;
      return started ? { type: 'intrusion', occurredAt: reading.recordedAt } : null;
    }
    const { detection } = event;
    const unknownFace = detection.faces.some((face) => face.name === null);
    return unknownFace && isRecent(detection.detectedAt, now)
      ? { type: 'unknown-face', occurredAt: detection.detectedAt }
      : null;
  }

  fromHeartbeat(lastMessageAt: Date | null, now: Date): Alert | null {
    if (!lastMessageAt) return null;
    const silent = now.getTime() - lastMessageAt.getTime() > DEVICE_OFFLINE_AFTER_MS;
    const wentOffline = silent && !this.offline;
    this.offline = silent;
    return wentOffline ? { type: 'device-offline', occurredAt: now } : null;
  }
}
