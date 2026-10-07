export class UnauthorizedError extends Error {
  constructor() {
    super('Session expirée.');
  }
}
