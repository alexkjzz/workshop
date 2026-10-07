import type { Reading, Telemetry } from '../domain/telemetry.js';
import type { VisionDetection } from '../domain/vision.js';

const RECENT_DETECTIONS = 50;

// Latest known state of the box and of the vision service, kept in memory.
export class DeviceState {
  private telemetry: Telemetry | null = null;
  private lastMessageAt: Date | null = null;
  private detections: VisionDetection[] = [];

  applyReading(reading: Reading) {
    // A reading replayed after a disconnection does not replace a newer one.
    if (this.lastMessageAt && reading.recordedAt < this.lastMessageAt) return;
    const { id: _id, recordedAt, source: _source, ...telemetry } = reading;
    this.telemetry = telemetry;
    this.lastMessageAt = recordedAt;
  }

  addDetection(detection: VisionDetection) {
    this.detections = [detection, ...this.detections].slice(0, RECENT_DETECTIONS);
  }

  latest() {
    return { telemetry: this.telemetry, lastMessageAt: this.lastMessageAt };
  }

  // Newest first.
  recentDetections(): VisionDetection[] {
    return this.detections;
  }
}
