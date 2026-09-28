import { mkdirSync, writeFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, type CollectionReference } from 'firebase-admin/firestore';

// Read-only JSON snapshot of every document in the database (all top-level
// collections and their subcollections), written to backups/. Use it before a
// deploy or migration when a managed `gcloud firestore export` is not available.
// Timestamps are written as { _seconds, _nanoseconds }.
//
//   npx tsx scripts/backup-firestore.ts
//
// Env: FIREBASE_PROJECT_ID (uncommon-men), FIREBASE_DATABASE_ID (conference).

const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
const databaseId = process.env.FIREBASE_DATABASE_ID || 'conference';

async function dump(collection: CollectionReference, out: Record<string, unknown>, counts: Record<string, number>) {
  const snapshot = await collection.get();
  const docs: Record<string, unknown> = {};
  for (const doc of snapshot.docs) {
    const subcollections: Record<string, unknown> = {};
    for (const child of await doc.ref.listCollections()) await dump(child, subcollections, counts);
    docs[doc.id] = Object.keys(subcollections).length ? { data: doc.data(), subcollections } : { data: doc.data() };
  }
  // Documents that only hold subcollections have no data of their own.
  for (const ref of await collection.listDocuments()) {
    if (ref.id in docs) continue;
    const subcollections: Record<string, unknown> = {};
    for (const child of await ref.listCollections()) await dump(child, subcollections, counts);
    if (Object.keys(subcollections).length) docs[ref.id] = { data: null, subcollections };
  }
  out[collection.id] = docs;
  const key = collection.path.split('/').map((segment, index) => (index % 2 ? '*' : segment)).join('/');
  counts[key] = (counts[key] ?? 0) + snapshot.size;
}

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const collections: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  for (const collection of await db.listCollections()) await dump(collection, collections, counts);
  const dir = 'backups';
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/firestore-${projectId}-${databaseId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ projectId, databaseId, takenAt: new Date().toISOString(), collections }, null, 2));
  console.table(counts);
  process.stdout.write(`Backup written to ${file}\n`);
}

main().catch((error) => {
  process.stderr.write(`Backup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
