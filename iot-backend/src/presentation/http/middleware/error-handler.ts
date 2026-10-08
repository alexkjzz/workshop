import type { ErrorRequestHandler } from 'express';
import {
  CommandDeliveryError,
  DeviceUnavailableError,
  InvalidRequestError,
  MailDeliveryError,
  MailUnavailableError,
  RateLimitedError,
} from '../../../application/errors.js';

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof InvalidRequestError) {
    response.status(400).json({ message: error.message });
  } else if (error instanceof RateLimitedError) {
    response.status(429).json({ message: error.message });
  } else if (error instanceof DeviceUnavailableError || error instanceof MailUnavailableError) {
    response.status(503).json({ message: error.message });
  } else if (error instanceof CommandDeliveryError || error instanceof MailDeliveryError) {
    response.status(502).json({ message: error.message });
  } else if (error && typeof error === 'object' && error.type === 'entity.too.large') {
    response.status(413).json({ message: 'Request body exceeds the allowed size.' });
  } else if (error instanceof SyntaxError) {
    response.status(400).json({ message: 'Request body must be valid JSON.' });
  } else {
    console.error('HTTP request failed.', error);
    response.status(500).json({ message: 'Internal server error.' });
  }
};
