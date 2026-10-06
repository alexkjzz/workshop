// Creates a dashboard account: npm run user:create -- <email> "<name>"
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createAuth } from './auth.js';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = prompt as unknown as { _writeToOutput: (text: string) => void };
    let muted = false;
    output._writeToOutput = (text) => {
      if (!muted || text.includes('\n')) process.stdout.write(muted ? '\n' : text);
    };
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer);
    });
    muted = true;
  });
}

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: npm run user:create -- <email> "<name>"');
  process.exit(1);
}

const password = process.env.AUTH_USER_PASSWORD ?? (await askHidden('Password: '));
if (!process.env.AUTH_USER_PASSWORD && password !== (await askHidden('Confirm password: '))) {
  console.error('Passwords do not match.');
  process.exit(1);
}

// The secret only signs session cookies; creating an account does not need the server's one.
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString('base64');
const auth = await createAuth({ allowSignUp: true });

try {
  const { user } = await auth.api.signUpEmail({ body: { email, password, name } });
  console.info(`Account created for ${user.email}.`);
} catch (error) {
  console.error('Could not create account:', error instanceof Error ? error.message : error);
  process.exit(1);
}
