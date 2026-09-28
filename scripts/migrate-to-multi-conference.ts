import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import {
  CONFERENCE_COLLECTIONS, conferenceFieldsFromEnv, conferenceIdFromEnv, conferenceRef,
  ensureConference, ensurePlatformSettings,
} from './lib/conference';

// Copies the single-conference top-level collections into
// conferences/{CONFERENCE_ID}/... (default uncommon-men-2026), preserving document
// ids and every field value, including timestamps. Creates the conference
// document (name "Uncommon Men 2026", status live) and settings/platform if
// missing. Idempotent: documents already present at the destination are never
// overwritten (the app may have updated them since), so it is safe to run again.
// Legacy top-level data is never modified or deleted.
//
//   npx tsx scripts/migrate-to-multi-conference.ts --dry-run
//   npx tsx scripts/migrate-to-multi-conference.ts
//
// Env: FIREBASE_PROJECT_ID (uncommon-men), FIREBASE_DATABASE_ID (conference),
// CONFERENCE_ID, and optionally CONFERENCE_NAME/START_DATE/END_DATE/LOCATION.
// Without explicit dates the conference spans the recorded attempts' dates (UTC).

const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
const databaseId = process.env.FIREBASE_DATABASE_ID || 'conference';
const dryRun = process.argv.includes('--dry-run');
const actor = { uid: 'system:multi-conference-migration', name: 'Multi-conference migration' };
const newTopLevel = new Set(['conferences', 'settings', 'platformRoles', 'platformAudit']);

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const equals = (left as { isEqual?: (other: unknown) => boolean }).isEqual;
  if (typeof equals === 'function') {
    try { return equals.call(left, right); } catch { return false; }
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => sameValue((left as DocumentData)[key], (right as DocumentData)[key]));
}

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= projectId;
  const conferenceId = conferenceIdFromEnv();
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const conference = conferenceRef(db, conferenceId);
  process.stdout.write(`${dryRun ? 'DRY RUN: ' : ''}${projectId}/${databaseId} -> conferences/${conferenceId}\n`);

  const unknown = (await db.listCollections())
    .map((collection) => collection.id)
    .filter((id) => !newTopLevel.has(id) && !(CONFERENCE_COLLECTIONS as readonly string[]).includes(id));
  if (unknown.length) process.stdout.write(`Not migrated (unrecognized top-level collections): ${unknown.join(', ')}\n`);

  const legacy = new Map<string, Map<string, DocumentData>>();
  for (const name of CONFERENCE_COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    legacy.set(name, new Map(snapshot.docs.map((doc) => [doc.id, doc.data()])));
    for (const doc of snapshot.docs) {
      const nested = await doc.ref.listCollections();
      if (nested.length) throw new Error(`${name}/${doc.id} has subcollections (${nested.map((c) => c.id).join(', ')}); refusing to migrate partially.`);
    }
  }

  const attemptDates = [...legacy.get('attempts')!.values()]
    .map((attempt) => attempt.createdAt?.toDate?.() as Date | undefined)
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
    .map((date) => date.toISOString().slice(0, 10))
    .sort();
  const fields = conferenceFieldsFromEnv(conferenceId, {
    name: 'Uncommon Men 2026',
    status: 'live',
    startDate: attemptDates[0],
    endDate: attemptDates.at(-1),
  });

  const conferenceExists = (await conference.get()).exists;
  const settingsExists = (await db.collection('settings').doc('platform').get()).exists;
  const plan: Record<string, { legacy: number; toCopy: number; alreadyIdentical: number; keptDifferent: number }> = {};
  const toCopy: { name: string; id: string; data: DocumentData }[] = [];
  const differing: string[] = [];
  for (const name of CONFERENCE_COLLECTIONS) {
    const target = await conference.collection(name).get();
    const existing = new Map(target.docs.map((doc) => [doc.id, doc.data()]));
    const row = { legacy: legacy.get(name)!.size, toCopy: 0, alreadyIdentical: 0, keptDifferent: 0 };
    for (const [id, data] of legacy.get(name)!) {
      const current = existing.get(id);
      if (!current) {
        row.toCopy += 1;
        toCopy.push({ name, id, data });
      } else if (sameValue(current, data)) row.alreadyIdentical += 1;
      else {
        row.keptDifferent += 1;
        differing.push(`${name}/${id}`);
      }
    }
    plan[name] = row;
  }
  process.stdout.write(`Conference document: ${conferenceExists ? 'exists (unchanged)' : `will be created ${JSON.stringify(fields)}`}\n`);
  process.stdout.write(`settings/platform: ${settingsExists ? 'exists (unchanged)' : `will be created with defaultConferenceId ${conferenceId}`}\n`);
  console.table(plan);
  // A legacy document changed after an earlier run copied it (or the app has
  // since changed the copy). It is never overwritten; review these by hand.
  if (differing.length) process.stdout.write(`Kept (destination differs from legacy): ${differing.join(', ')}\n`);
  if (dryRun) {
    process.stdout.write('Dry run only. Nothing was written.\n');
    return;
  }

  if (await ensureConference(db, conferenceId, fields, actor, 'Migrated the single-conference data into its own conference'))
    process.stdout.write(`Created conferences/${conferenceId}.\n`);
  if (await ensurePlatformSettings(db, conferenceId, actor, 'Default conference after the multi-conference migration'))
    process.stdout.write(`Created settings/platform (defaultConferenceId ${conferenceId}).\n`);

  const writer = db.bulkWriter();
  let alreadyThere = 0;
  writer.onWriteError((error) => {
    // create() fails when another run (or the app) wrote the document first.
    if (error.code === 6 /* ALREADY_EXISTS */) {
      alreadyThere += 1;
      return false;
    }
    return error.failedAttempts < 5;
  });
  for (const { name, id, data } of toCopy)
    void writer.create(conference.collection(name).doc(id), data).catch(() => undefined);
  await writer.close();
  process.stdout.write(`Copied ${toCopy.length - alreadyThere} documents${alreadyThere ? ` (${alreadyThere} appeared meanwhile and were kept)` : ''}.\n`);

  // Verification: every legacy document exists at its destination.
  const verification: Record<string, { legacy: number; destination: number; missing: number; identical: number; different: number }> = {};
  let missingTotal = 0;
  for (const name of CONFERENCE_COLLECTIONS) {
    const target = await conference.collection(name).get();
    const existing = new Map(target.docs.map((doc) => [doc.id, doc.data()]));
    const row = { legacy: legacy.get(name)!.size, destination: target.size, missing: 0, identical: 0, different: 0 };
    for (const [id, data] of legacy.get(name)!) {
      const current = existing.get(id);
      if (!current) row.missing += 1;
      else if (sameValue(current, data)) row.identical += 1;
      else row.different += 1;
    }
    missingTotal += row.missing;
    verification[name] = row;
  }
  console.table(verification);
  if (missingTotal) throw new Error(`${missingTotal} legacy documents are missing from conferences/${conferenceId}.`);
  process.stdout.write('Verified: every legacy document exists under the conference. Legacy data was not modified.\n');
}

main().catch((error) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
