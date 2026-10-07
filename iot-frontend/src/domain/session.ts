export interface UserSession {
  userName: string;
  userEmail: string;
}

export type SignInFailure = 'invalid-credentials' | 'rate-limited' | 'unknown';
