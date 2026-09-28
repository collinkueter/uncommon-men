import { mkdirSync, writeFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFERENCE_COLLECTIONS, conferenceIdFromEnv, conferenceRef } from './lib/conference';

// Clears practice data from one conference (CONFERENCE_ID, default uncommon-men-2026)
// before the real competition: anonymous users and everything they entered there.
// Keeps categories, events, their audit history, the conference document, its admins,
// and every non-anonymous (admin) account + identity. Anonymous accounts that also
// hold an identity in another conference are kept.
// Dry run by default. Pass --apply to delete. A JSON backup is always written first.

const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
const databaseId = process.env.FIREBASE_DATABASE_ID || 'conference';
const apply = process.argv.includes('--apply');
const wipeCollections = ['participants', 'teams', 'attempts', 'brackets', 'games'];
const keptAuditEntities = new Set(['categories', 'events', 'conference', 'admins']);

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const conferenceId = conferenceIdFromEnv();
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const auth = getAuth(app);
  const db = getFirestore(app, databaseId);
  const conference = conferenceRef(db, conferenceId);
  if (!(await conference.get()).exists) throw new Error(`conferences/${conferenceId} does not exist.`);

  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  const kept = users.filter(user => user.providerData.length > 0);
  const keptUids = new Set(kept.map(user => user.uid));

  const backup: Record<string, Record<string, unknown>> = {};
  for (const name of CONFERENCE_COLLECTIONS) {
    const snapshot = await conference.collection(name).get();
    backup[name] = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));
  }
  // Identities in other conferences belong to people this reset must not remove.
  const elsewhere = new Set<string>();
  for (const other of await db.collection('conferences').listDocuments()) {
    if (other.id === conferenceId) continue;
    for (const identity of await other.collection('identities').listDocuments()) elsewhere.add(identity.id);
  }
  const anonymous = users.filter(user => user.providerData.length === 0 && !elsewhere.has(user.uid));

  const dir = `backups/reset-${conferenceId}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/firestore.json`, JSON.stringify({ conferenceId, collections: backup }, null, 2));
  writeFileSync(`${dir}/auth-users.json`, JSON.stringify(users.map(user => user.toJSON()), null, 2));

  const deletes = [
    ...wipeCollections.flatMap(name => Object.keys(backup[name] ?? {}).map(id => conference.collection(name).doc(id))),
    ...Object.keys(backup.identities ?? {}).filter(id => !keptUids.has(id)).map(id => conference.collection('identities').doc(id)),
    ...Object.entries(backup.audit ?? {})
      .filter(([, data]) => {
        const entry = data as { entityType?: string; entityId?: string };
        if (keptAuditEntities.has(String(entry.entityType))) return false;
        return !(entry.entityType === 'identities' && keptUids.has(String(entry.entityId)));
      })
      .map(([id]) => conference.collection('audit').doc(id)),
  ];

  const byCollection = deletes.reduce<Record<string, number>>((counts, ref) => {
    counts[ref.parent.id] = (counts[ref.parent.id] ?? 0) + 1;
    return counts;
  }, {});
  process.stdout.write(`Conference: ${projectId}/${databaseId} conferences/${conferenceId}\n`);
  process.stdout.write(`Backup written to ${dir}\n`);
  process.stdout.write(`Firestore docs to delete: ${JSON.stringify(byCollection)}\n`);
  process.stdout.write(`Anonymous auth users to delete: ${anonymous.length} (${elsewhere.size} identities in other conferences protected)\n`);
  process.stdout.write(`Auth users kept: ${kept.map(user => user.email ?? user.uid).join(', ')}\n`);
  if (!apply) {
    process.stdout.write('Dry run only. Pass --apply to delete.\n');
    return;
  }

  const writer = db.bulkWriter();
  for (const ref of deletes) writer.delete(ref);
  await writer.close();
  for (let i = 0; i < anonymous.length; i += 1000) {
    const result = await auth.deleteUsers(anonymous.slice(i, i + 1000).map(user => user.uid));
    if (result.failureCount) throw new Error(`${result.failureCount} auth deletions failed`);
  }
  process.stdout.write(`Deleted ${deletes.length} Firestore docs and ${anonymous.length} anonymous users.\n`);
}

main().catch(error => {
  process.stderr.write(`Reset failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
