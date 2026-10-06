import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { loadAuthConfig } from './config.js';

interface AuthOptions {
  // Public sign-up stays closed; accounts are created with `npm run user:create`.
  allowSignUp?: boolean;
}

function authOptions({ allowSignUp = false }: AuthOptions) {
  const config = loadAuthConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });

  return {
    appName: 'SENTINEL-X',
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: new DatabaseSync(config.databasePath),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignUp,
      autoSignIn: false,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
      },
    },
    // The table network is offline; never try to reach external services.
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

// Creates the auth tables before Better Auth validates the schema.
export async function createAuth(options: AuthOptions = {}) {
  const resolved = authOptions(options);
  const { runMigrations } = await getMigrations(resolved);
  await runMigrations();
  return betterAuth(resolved);
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
