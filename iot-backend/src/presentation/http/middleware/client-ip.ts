import type { RequestHandler } from 'express';

// Only trusted proxies (Vite locally, nginx in Docker) may report the client
// address (`trust proxy` setting). Better Auth reads X-Forwarded-For for rate
// limiting, so it is rewritten with the resolved client IP to prevent spoofing.
export const normalizeClientIp: RequestHandler = (request, _response, next) => {
  request.headers['x-forwarded-for'] = request.ip;
  next();
};
