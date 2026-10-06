import { createAuthClient } from 'better-auth/client';
import type { AuthService } from '../application/ports';
import type { SignInFailure, UserSession } from '../domain/session';

export class BetterAuthService implements AuthService {
  // Same origin: /api/auth is forwarded to the backend.
  private readonly client = createAuthClient();

  async getSession(): Promise<UserSession | null> {
    const { data } = await this.client.getSession();
    return data ? { userName: data.user.name, userEmail: data.user.email } : null;
  }

  async signIn(email: string, password: string): Promise<SignInFailure | null> {
    const { error } = await this.client.signIn.email({ email, password });
    if (!error) return null;
    if (error.status === 429) return 'rate-limited';
    return error.code === 'INVALID_EMAIL_OR_PASSWORD' ? 'invalid-credentials' : 'unknown';
  }

  async signOut() {
    await this.client.signOut();
  }
}
