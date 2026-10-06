import { Router } from 'express';
import type { GetReadingHistory } from '../../../application/use-cases/get-reading-history.js';

export function readingRoutes(getReadingHistory: GetReadingHistory) {
  const router = Router();

  // Sensor history, newest first.
  router.get('/readings', (request, response) => {
    response.json({ readings: getReadingHistory.execute(Number(request.query.limit ?? 100)) });
  });

  return router;
}
