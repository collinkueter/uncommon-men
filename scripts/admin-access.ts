import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const usage = 'Usage: npx tsx scripts/admin-access.ts <grant|revoke> <email>';

function fail(message: string): never {
  process.stderr.write(`${message}\n${usage}\n`);
  process.exit(1);
}

function parseArgs(args: string[]): { action: 'grant' | 'revoke'; email: string } {
  if (args.length !== 2) fail('Expected exactly one action and one email address.');

  const [action, email] = args;
  if (action !== 'grant' && action !== 'revoke') {
    fail(`Unknown action: ${action}`);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`Invalid email address: ${email || '(missing)'}`);
  }

  return { action, email };
}

async function main() {
  const { action, email } = parseArgs(process.argv.slice(2));
  const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const auth = getAuth(app);

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      throw new Error(`No existing Firebase Auth user was found for ${email}.`);
    }
    throw error;
  }

  const claims = { ...(user.customClaims ?? {}) };
  if (action === 'grant') {
    claims.admin = true;
  } else {
    delete claims.admin;
  }

  await auth.setCustomUserClaims(user.uid, claims);
  process.stdout.write(
    `${action === 'grant' ? 'Granted' : 'Revoked'} admin access for ${email} in ${projectId}.\n`,
  );
}

main().catch(error => {
  process.stderr.write(`Admin access change failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
