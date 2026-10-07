import type { AiGateway } from '../../application/ports.js';
import type { AiSensorSample } from '../../domain/ai.js';
import { parseAiPrediction, parseAiStatus, parseAiVision, parseFaces, parseFaceLatest, parseFaceHistory } from './ai-contract.js';

export class HttpAiGateway implements AiGateway {
  private readonly baseUrl: string;

  constructor(url: string, private readonly timeoutMs = 5000, private readonly token = '') {
    this.baseUrl = url.replace(/\/$/, '');
  }

  isConfigured() { return this.baseUrl !== ''; }

  async analyze(sample: AiSensorSample) {
    const prediction = parseAiPrediction(await this.request('/analyze', 'POST', sample));
    if (prediction.sample_id !== sample.sample_id || prediction.source !== sample.source) {
      throw new Error('AI prediction does not match the submitted sensor sample.');
    }
    return prediction;
  }

  async status() { return parseAiStatus(await this.request('/status')); }

  async visionStatus() { return parseAiVision(await this.request('/vision/status')); }
  async facesStatus() { return parseFaces(await this.request('/vision/faces/status')); }
  async facesLatest() { return parseFaceLatest(await this.request('/vision/faces/latest')); }
  async facesHistory() { return parseFaceHistory(await this.request('/vision/faces/history')); }
  async reloadFaces() { return parseFaces(await this.request('/vision/faces/reload', 'POST', undefined, 60_000)); }

  async controlVision(action: 'start' | 'stop') {
    return parseAiVision(await this.request(`/vision/${action}`, 'POST'));
  }

  private async request(path: string, method = 'GET', body?: AiSensorSample, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (!this.isConfigured()) throw new Error('AI service is disabled.');
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404 && path.startsWith('/vision/faces/')) {
        throw new Error('Le service IA lancé ne fournit pas les routes faciales. Redémarrez le service IA pour charger le nouveau code.');
      }
      if (!response.ok) throw new Error(`AI service returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('AI service request timed out.');
      if (error instanceof TypeError) throw new Error('AI service is unreachable.');
      throw error;
    }
  }
}
