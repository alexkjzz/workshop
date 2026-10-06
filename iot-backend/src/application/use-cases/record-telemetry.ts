import { resolveRecordedAt, type Reading, type TelemetryMeasurement } from '../../domain/telemetry.js';
import type { DeviceState } from '../device-state.js';
import type { Clock, LiveEvents, ReadingRepository } from '../ports.js';

export class RecordTelemetry {
  constructor(
    private readonly readings: ReadingRepository,
    private readonly state: DeviceState,
    private readonly events: LiveEvents,
    private readonly clock: Clock,
    private readonly retentionMs: number,
  ) {}

  execute({ telemetry, measuredAt }: TelemetryMeasurement): Reading {
    const recordedAt = resolveRecordedAt(measuredAt, this.clock.now(), this.retentionMs);
    const reading = this.readings.save(telemetry, recordedAt);
    this.state.applyReading(reading);
    this.events.publish({ type: 'reading', reading });
    return reading;
  }
}
