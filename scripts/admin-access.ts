import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { conferenceIdFromEnv, conferenceRef } from './lib/conference';

// Grants and revokes roles.
//   grant|revoke <email>                    Firebase Auth custom claim admin: true (organizer, legacy bootstrap).
//   grant-organizer|revoke-organizer <email> platformRoles/{email} (organizer across all conferences).
//   grant-conference-admin|revoke-conference-admin <email>
//                                           conferences/{CONFERENCE_ID}/admins/{email} (one conference).
// Email roles need a Google sign-in with a verified email; they apply without signing in again.
const actions = [
  'grant', 'revoke', 'grant-organizer', 'revoke-organizer', 'grant-conference-admin', 'revoke-conference-admin',
] as const;
type Action = (typeof actions)[number];
const usage = `Usage: [CONFERENCE_ID=<slug>] npx tsx scripts/admin-access.ts <${actions.join('|')}> <email>`;
const actorUid = 'system:admin-access';
const actorName = 'Operator admin-access script';

function fail(message: string): never {
  process.stderr.write(`${message}\n${usage}\n`);
  process.exit(1);
}

function parseArgs(args: string[]): { action: Action; email: string } {
  if (args.length !== 2) fail('Expected exactly one action and one email address.');

  const [action, email] = args;
  if (!(actions as readonly string[]).includes(action)) {
    fail(`Unknown action: ${action}`);
  }

  if (!email || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) {
    fail(`Invalid email address: ${email || '(missing)'}`);
  }

  return { action: action as Action, email };
}

// Role documents are keyed by the lowercased email. Each change writes an audit
// entry; a revoke's entry id is "<grant auditId>-revoke", which the rules require.
async function setRoleDocument(
  db: Firestore, ref: DocumentReference, auditCollection: string, entityType: string,
  grant: boolean, value: Record<string, unknown>, action: string,
) {
  const auditRoot = auditCollection === 'platformAudit' ? db.collection('platformAudit') : ref.parent.parent!.collection('audit');
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (grant === existing.exists) return false;
    const before = existing.exists ? existing.data()! : null;
    const auditRef = grant ? auditRoot.doc() : auditRoot.doc(`${String(before?.auditId)}-revoke`);
    const after = grant ? { ...value, auditId: auditRef.id } : null;
    if (after) transaction.create(ref, after);
    else transaction.delete(ref);
    transaction.create(auditRef, {
      action, entityType, entityId: ref.id, actorUid, actorName,
      at: FieldValue.serverTimestamp(), before, after, reason: `${action} via operator script`,
    });
    return true;
  });
}

async function main() {
  const { action, email } = parseArgs(process.argv.slice(2));
  const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
  const databaseId = process.env.FIREBASE_DATABASE_ID || 'conference';
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });

  if (action === 'grant' || action === 'revoke') {
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
    return;
  }

  const db = getFirestore(app, databaseId);
  const key = email.toLowerCase();
  const grant = action.startsWith('grant-');
  let changed: boolean;
  let where: string;
  if (action.endsWith('-organizer')) {
    where = `platformRoles/${key}`;
    changed = await setRoleDocument(
      db, db.collection('platformRoles').doc(key), 'platformAudit', 'platformRoles', grant,
      { role: 'organizer' }, grant ? 'grantOrganizer' : 'revokeOrganizer',
    );
  } else {
    const conferenceId = conferenceIdFromEnv();
    const conference = conferenceRef(db, conferenceId);
    if (!(await conference.get()).exists) throw new Error(`conferences/${conferenceId} does not exist.`);
    where = `conferences/${conferenceId}/admins/${key}`;
    changed = await setRoleDocument(
      db, conference.collection('admins').doc(key), 'conference', 'admins', grant,
      { email: key }, grant ? 'grantAdmin' : 'revokeAdmin',
    );
  }
  process.stdout.write(
    changed
      ? `${grant ? 'Granted' : 'Revoked'} ${where} in ${projectId}/${databaseId}.\n`
      : `No change: ${where} was already ${grant ? 'granted' : 'absent'}.\n`,
  );
}

main().catch(error => {
  process.stderr.write(`Admin access change failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
