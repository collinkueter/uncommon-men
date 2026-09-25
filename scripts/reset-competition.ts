import { mkdirSync, writeFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Clears practice data before the real competition: anonymous users and everything they entered.
// Keeps categories, events, their audit history, and every non-anonymous (admin) account + identity.
// Dry run by default. Pass --apply to delete. A JSON backup is always written first.

const projectId = 'uncommon-men';
const databaseId = 'conference';
const apply = process.argv.includes('--apply');
const wipeCollections = ['participants', 'teams', 'attempts', 'brackets', 'games'];
const keptAuditEntities = new Set(['categories', 'events']);

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const auth = getAuth(app);
  const db = getFirestore(app, databaseId);

  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  const anonymous = users.filter(user => user.providerData.length === 0);
  const kept = users.filter(user => user.providerData.length > 0);
  const keptUids = new Set(kept.map(user => user.uid));

  const backup: Record<string, Record<string, unknown>> = {};
  for (const collection of await db.listCollections()) {
    const snapshot = await collection.get();
    backup[collection.id] = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));
  }
  const dir = `backups/reset-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/firestore.json`, JSON.stringify(backup, null, 2));
  writeFileSync(`${dir}/auth-users.json`, JSON.stringify(users.map(user => user.toJSON()), null, 2));

  const deletes = [
    ...wipeCollections.flatMap(name => Object.keys(backup[name] ?? {}).map(id => db.collection(name).doc(id))),
    ...Object.keys(backup.identities ?? {}).filter(id => !keptUids.has(id)).map(id => db.collection('identities').doc(id)),
    ...Object.entries(backup.audit ?? {})
      .filter(([, data]) => {
        const entry = data as { entityType?: string; entityId?: string };
        if (keptAuditEntities.has(String(entry.entityType))) return false;
        return !(entry.entityType === 'identities' && keptUids.has(String(entry.entityId)));
      })
      .map(([id]) => db.collection('audit').doc(id)),
  ];

  const byCollection = deletes.reduce<Record<string, number>>((counts, ref) => {
    counts[ref.parent.id] = (counts[ref.parent.id] ?? 0) + 1;
    return counts;
  }, {});
  process.stdout.write(`Backup written to ${dir}\n`);
  process.stdout.write(`Firestore docs to delete: ${JSON.stringify(byCollection)}\n`);
  process.stdout.write(`Anonymous auth users to delete: ${anonymous.length}\n`);
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
