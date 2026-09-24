import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initialCategories, initialEvents } from '../src/domain/catalog';

async function main() {
const projectId = process.env.FIREBASE_PROJECT_ID || 'uncommon-men';
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
const databaseId = process.env.FIREBASE_DATABASE_ID || 'conference';
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
let created = 0;
for (const [collectionName, records] of [['categories', initialCategories], ['events', initialEvents]] as const) {
  for (const record of records) {
    const ref = db.collection(collectionName).doc(record.id);
    await db.runTransaction(async transaction => {
      if ((await transaction.get(ref)).exists) return;
      const auditRef = db.collection('audit').doc();
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
process.stdout.write(`Provisioned ${projectId}/${databaseId}: ${created} catalog records added; administrator configured. No sample results added.\n`);

}
main().catch(error => { process.stderr.write(`Provisioning failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
