import { Router } from 'express';
import type { AiCoordinator } from '../../../application/ai-coordinator.js';

export function aiRoutes(ai: AiCoordinator) {
  const router = Router();

  router.get('/ai/status', (_request, response) => response.json(ai.getStatus()));
  router.get('/ai/latest', (_request, response) => response.json(ai.getLatest()));
  router.get('/ai/vision/status', async (_request, response) => {
    try {
      response.json(await ai.getVisionStatus());
    } catch (error) {
      response.status(503).json({ message: error instanceof Error ? error.message : 'Le service IA est indisponible.' });
    }
  });
  router.get('/ai/history', (request, response) => {
    response.json({ predictions: ai.getHistory(Number(request.query.limit ?? 50)) });
  });

  for (const action of ['status', 'latest', 'history'] as const) {
    router.get(`/ai/vision/faces/${action}`, async (_request, response) => {
      try {
        response.json(await (action === 'status' ? ai.getFacesStatus()
          : action === 'latest' ? ai.getFacesLatest() : ai.getFacesHistory()));
      } catch (error) {
        response.status(503).json({ message: error instanceof Error ? error.message : 'Le service facial est indisponible.' });
      }
    });
  }
  router.post('/ai/vision/faces/reload', async (_request, response) => {
    try { response.json(await ai.reloadFaces()); }
    catch (error) {
      response.status(503).json({ message: error instanceof Error ? error.message : 'Impossible de recharger les visages connus.' });
    }
  });

  for (const action of ['start', 'stop'] as const) {
    router.post(`/ai/vision/${action}`, async (_request, response) => {
      try {
        response.json(await ai.controlVision(action));
      } catch (error) {
        response.status(503).json({ message: error instanceof Error ? error.message : 'AI service is unavailable.' });
      }
    });
  }
  return router;
}
