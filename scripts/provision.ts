import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initialCategories, initialEvents } from '../src/domain/catalog';
import {
  conferenceFieldsFromEnv, conferenceIdFromEnv, conferenceRef, ensureConference, ensurePlatformSettings,
} from './lib/conference';

// Idempotent setup of one conference: creates conferences/{CONFERENCE_ID} if
// missing (CONFERENCE_NAME, CONFERENCE_START_DATE, CONFERENCE_END_DATE,
// CONFERENCE_LOCATION, CONFERENCE_STATUS), settings/platform if missing, the
// missing catalog records with audit entries, and the ADMIN_EMAIL organizer claim.
async function main() {
const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
const databaseId = process.env.FIREBASE_DATABASE_ID || 'conference';
const conferenceId = conferenceIdFromEnv();
const ownerEmail = process.env.ADMIN_EMAIL;
if (!ownerEmail) throw new Error('Set ADMIN_EMAIL to the conference administrator email.');
// Use the authenticated operator credential in memory. No service-account keys are created.
const app = initializeApp({ projectId, credential: applicationDefault() });
const auth = getAuth(app);
let owner;
try { owner = await auth.getUserByEmail(ownerEmail); }
catch (error) {
  if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  owner = await auth.createUser({ email: ownerEmail });
}
await auth.setCustomUserClaims(owner.uid, { ...owner.customClaims, admin: true });
const db = getFirestore(app, databaseId);
const actor = { uid: owner.uid, name: 'Conference setup' };
const conferenceCreated = await ensureConference(
  db, conferenceId, conferenceFieldsFromEnv(conferenceId), actor, 'Conference provisioned',
);
const settingsCreated = await ensurePlatformSettings(db, conferenceId, actor, 'First provisioned conference is the default');
const conference = conferenceRef(db, conferenceId);
let created = 0;
for (const [collectionName, records] of [['categories', initialCategories], ['events', initialEvents]] as const) {
  for (const record of records) {
    const ref = conference.collection(collectionName).doc(record.id);
    await db.runTransaction(async transaction => {
      if ((await transaction.get(ref)).exists) return;
      const auditRef = conference.collection('audit').doc();
      const { id: _id, ...fields } = record;
      const after = { ...fields, auditId: auditRef.id };
      transaction.create(ref, after);
      transaction.create(auditRef, {
        action: 'initialSetup', entityType: collectionName, entityId: record.id,
        actorUid: owner.uid, actorName: 'Conference setup', at: FieldValue.serverTimestamp(),
        before: null, after, reason: 'Initial conference catalog from approved implementation plan',
      });
      created += 1;
    });
  }
}
process.stdout.write(
  `Provisioned ${projectId}/${databaseId} conferences/${conferenceId}: `
  + `${conferenceCreated ? 'conference created' : 'conference already existed'}; `
  + `${settingsCreated ? `default conference set to ${conferenceId}` : 'default conference unchanged'}; `
  + `${created} catalog records added; administrator configured. No sample results added.\n`,
);

}
main().catch(error => { process.stderr.write(`Provisioning failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
