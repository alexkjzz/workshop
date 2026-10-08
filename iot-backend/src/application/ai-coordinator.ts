import type { AiPrediction, AiSensorSample, AiSource, AiStatus, StoredAiPrediction, VisionResult } from '../domain/ai.js';
import type { Reading } from '../domain/telemetry.js';
import type { FaceEnrollmentRequest, FaceRecognitionResult } from '../domain/faces.js';
import { InvalidRequestError } from './errors.js';
import type { AiGateway, AiPredictionRepository, Clock, LiveEvents } from './ports.js';

const LIVE_SAMPLE_MAX_AGE_MS = 30_000;
const SAMPLE_CLOCK_SKEW_MS = 5_000;
const MAX_HISTORY = 500;

// Serial inference preserves temporal feature order. MQTT and HTTP never wait for it.
export class AiCoordinator {
  private readonly queue: AiSensorSample[] = [];
  private processing = false;
  private checking = false;
  private closed = false;
  private visionRevision = 0;
  private readonly lastSensorTime: Record<AiSource, number> = { live: -Infinity, simulation: -Infinity };
  private readonly latestBySource: Record<AiSource, StoredAiPrediction | null> = { live: null, simulation: null };
  private readonly recordedKeys = new Set<string>();
  private state: AiStatus = {
    online: false, model_loaded: false, vision: null,
    last_success_at: null, last_error: null, queue_depth: 0, dropped_samples: 0,
  };

  constructor(
    private readonly gateway: AiGateway,
    private readonly repository: AiPredictionRepository,
    private readonly events: LiveEvents,
    private readonly clock: Clock,
    private readonly queueLimit = 32,
    cameraSource: AiStatus['camera_source'] = 'ai',
  ) {
    this.state.camera_source = cameraSource;
    for (const prediction of repository.findRecent(MAX_HISTORY)) {
      this.recordedKeys.add(this.predictionKey(prediction));
      this.latestBySource[prediction.source] ??= prediction;
    }
  }

  enqueue(reading: Reading, source: AiSource = reading.source ?? 'live') {
    if (this.closed || !this.gateway.isConfigured()) return;
    const timestamp = reading.recordedAt.getTime();
    const age = this.clock.now().getTime() - timestamp;
    // History replay is stored by the backend, but cannot become a current threat.
    if (!Number.isFinite(age) || age > LIVE_SAMPLE_MAX_AGE_MS || age < -SAMPLE_CLOCK_SKEW_MS
      || timestamp < this.lastSensorTime[source]) return;
    this.lastSensorTime[source] = timestamp;
    // Device outputs and readiness flags belong to monitoring, not model features.
    const sample: AiSensorSample = {
      sample_id: reading.id, timestamp: reading.recordedAt.toISOString(), source,
      ...(reading.climateValid !== false && reading.temperature !== undefined ? { temperature: reading.temperature } : {}),
      ...(reading.climateValid !== false && reading.humidity !== undefined ? { humidity: reading.humidity } : {}),
      ...(reading.gasReady !== false && reading.gas !== undefined ? { gas: reading.gas } : {}),
      ...(reading.pirReady !== false && reading.presence !== undefined ? { presence: reading.presence } : {}),
    };
    if (this.queue.length >= this.queueLimit) {
      this.queue.shift();
      this.state.dropped_samples += 1;
    }
    this.queue.push(sample);
    this.publishStatus();
    void this.drain();
  }

  getStatus(): AiStatus {
    return { ...this.state, queue_depth: this.queue.length + Number(this.processing) };
  }

  getLatest(): StoredAiPrediction | null {
    const { live, simulation } = this.latestBySource;
    if (live) {
      // Camera/status updates must not renew the age of an old physical sensor sample.
      const age = this.clock.now().getTime() - Date.parse(live.sensor_timestamp ?? live.timestamp);
      if (age >= -SAMPLE_CLOCK_SKEW_MS && age <= LIVE_SAMPLE_MAX_AGE_MS) return live;
    }
    if (!live) return simulation;
    if (!simulation) return live;
    return Date.parse(live.timestamp) >= Date.parse(simulation.timestamp) ? live : simulation;
  }

  getHistory(limit: number): StoredAiPrediction[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY) {
      throw new InvalidRequestError(`limit must be an integer between 1 and ${MAX_HISTORY}.`);
    }
    return this.repository.findRecent(limit);
  }

  async refresh(): Promise<void> {
    if (this.closed || this.checking || !this.gateway.isConfigured()) return;
    this.checking = true;
    const revision = this.visionRevision;
    try {
      const status = await this.gateway.status();
      if (this.closed || revision !== this.visionRevision) return;
      this.succeeded(status.model_loaded, status.vision);
      // Vision can change while no sensor message arrives.
      if (status.latest_prediction) this.record(status.latest_prediction);
    } catch (error) {
      if (!this.closed && revision === this.visionRevision) this.failed(error);
    } finally {
      this.checking = false;
    }
  }

  async controlVision(action: 'start' | 'stop'): Promise<VisionResult> {
    const revision = ++this.visionRevision;
    try {
      const vision = await this.gateway.controlVision(action);
      if (revision === this.visionRevision && !this.closed) this.succeeded(this.state.model_loaded, vision);
      return vision;
    } catch (error) {
      if (revision === this.visionRevision && !this.closed) this.failed(error);
      throw error;
    }
  }

  async getVisionStatus(): Promise<VisionResult> {
    const revision = this.visionRevision;
    try {
      const vision = this.gateway.visionStatus
        ? await this.gateway.visionStatus() : (await this.gateway.status()).vision;
      if (revision === this.visionRevision && !this.closed) this.succeeded(this.state.model_loaded, vision);
      return vision;
    } catch (error) {
      if (revision === this.visionRevision && !this.closed) this.failed(error);
      throw error;
    }
  }

  async getFacesStatus() {
    if (!this.gateway.facesStatus) throw new Error('Le service IA ne prend pas en charge la reconnaissance faciale.');
    const revision = this.visionRevision;
    const faces = await this.gateway.facesStatus();
    if (revision === this.visionRevision && !this.closed) this.updateFaces(faces);
    return faces;
  }

  async getFacesLatest() {
    if (!this.gateway.facesLatest) throw new Error('Le service facial est indisponible.');
    return this.gateway.facesLatest();
  }

  async getFacesHistory() {
    if (!this.gateway.facesHistory) throw new Error('Le service facial est indisponible.');
    return this.gateway.facesHistory();
  }

  async reloadFaces() {
    if (!this.gateway.reloadFaces) throw new Error('Le service facial est indisponible.');
    const revision = ++this.visionRevision;
    const faces = await this.gateway.reloadFaces();
    if (revision === this.visionRevision && !this.closed) this.updateFaces(faces);
    return faces;
  }

  async enrollFaces(request: FaceEnrollmentRequest) {
    if (!this.gateway.enrollFaces) throw new Error('Le service facial est indisponible.');
    const revision = ++this.visionRevision;
    const result = await this.gateway.enrollFaces(request);
    if (revision === this.visionRevision && !this.closed) this.updateFaces(result.catalog);
    return result;
  }

  private updateFaces(faces: FaceRecognitionResult) {
    if (!this.state.vision) return;
    if (this.state.vision.faces && Date.parse(faces.timestamp) < Date.parse(this.state.vision.faces.timestamp)) return;
    this.succeeded(this.state.model_loaded, { ...this.state.vision, faces,
      timestamp: Date.parse(faces.timestamp) > Date.parse(this.state.vision.timestamp) ? faces.timestamp : this.state.vision.timestamp });
  }

  stop() {
    this.closed = true;
    this.queue.length = 0;
  }

  private async drain() {
    if (this.processing || this.closed) return;
    this.processing = true;
    try {
      while (this.queue.length && !this.closed) {
        const sample = this.queue.shift()!;
        const age = this.clock.now().getTime() - Date.parse(sample.timestamp);
        if (!Number.isFinite(age) || age > LIVE_SAMPLE_MAX_AGE_MS || age < -SAMPLE_CLOCK_SKEW_MS) {
          this.state.dropped_samples += 1;
          continue;
        }
        try {
          const revision = this.visionRevision;
          const prediction = await this.gateway.analyze(sample);
          if (this.closed) break;
          this.succeeded(prediction.anomaly.status === 'ready'
            || (prediction.anomaly.status !== 'untrained' && this.state.model_loaded),
            sample.source === 'simulation' || revision !== this.visionRevision ? this.state.vision : prediction.vision);
          this.record(prediction);
        } catch (error) {
          if (!this.closed) this.failed(error);
        }
      }
    } finally {
      this.processing = false;
      if (!this.closed) this.publishStatus();
    }
  }

  private record(prediction: AiPrediction) {
    const key = this.predictionKey(prediction);
    if (this.recordedKeys.has(key)) return;
    const stored = this.repository.save(prediction);
    this.recordedKeys.add(key);
    if (this.recordedKeys.size > MAX_HISTORY) this.recordedKeys.delete(this.recordedKeys.values().next().value!);
    const previous = this.latestBySource[prediction.source];
    if (!previous || Date.parse(prediction.timestamp) >= Date.parse(previous.timestamp)) this.latestBySource[prediction.source] = stored;
    this.events.publish({ type: 'ai', prediction: stored });
    console.info(`[AI] Prediction stored: ${prediction.risk.risk_level} score=${prediction.risk.risk_score}.`);
  }

  private predictionKey(prediction: AiPrediction): string {
    return `${prediction.source}:${prediction.timestamp}:${prediction.sample_id ?? 'vision'}`;
  }

  private succeeded(modelLoaded: boolean, vision: VisionResult | null) {
    if (this.state.vision && vision && Date.parse(vision.timestamp) < Date.parse(this.state.vision.timestamp)) vision = this.state.vision;
    this.state = { ...this.state, online: true, model_loaded: modelLoaded, vision,
      last_success_at: this.clock.now().toISOString(), last_error: null };
    this.publishStatus();
  }

  private failed(error: unknown) {
    const message = error instanceof Error ? error.message : 'AI service request failed.';
    if (this.state.online || this.state.last_error !== message) console.warn(`[AI] ${message}`);
    this.state = { ...this.state, online: false, last_error: message };
    this.publishStatus();
  }

  private publishStatus() {
    this.events.publish({ type: 'ai-status', status: this.getStatus() });
  }
}
