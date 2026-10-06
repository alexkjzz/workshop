import { createAuthClient } from 'better-auth/react';

// Same origin: Vite (or the reverse proxy) forwards /api/auth to the backend.
export const authClient = createAuthClient();
