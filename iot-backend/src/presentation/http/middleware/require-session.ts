import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler, Response } from 'express';
import type { Session, SessionVerifier } from '../../../application/ports.js';

function toHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

export function requireSession(sessions: SessionVerifier): RequestHandler {
  return async (request, response, next) => {
    const session = await sessions.verify(toHeaders(request.headers));
    if (!session) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }
    response.locals.session = session;
    next();
  };
}

export function currentSession(response: Response): Session {
  return response.locals.session as Session;
}
