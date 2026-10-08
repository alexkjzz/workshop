export class InvalidRequestError extends Error {}

export class FaceEnrollmentError extends Error {
  constructor(message: string, readonly statusCode: 400 | 413 | 422 | 503) { super(message); }
}

// The device cannot be reached (broker disconnected).
export class DeviceUnavailableError extends Error {}

// The command could not be handed to the broker.
export class CommandDeliveryError extends Error {}

// No mail transport is configured (SMTP).
export class MailUnavailableError extends Error {}

// The mail server refused or could not be reached.
export class MailDeliveryError extends Error {}

export class RateLimitedError extends Error {}

export class CameraStreamUnavailableError extends Error {
  constructor(message: string, readonly statusCode = 503) { super(message); }
}
