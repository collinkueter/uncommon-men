import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initialEvents } from "../src/domain/catalog";

const projectId = "uncommon-men";
const databaseId = "conference";
const oldId = "dumbbell-hold-10-lb";
const newId = "dumbbell-hold-15-lb";
const apply = process.argv.includes("--apply");

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const oldRef = db.collection("events").doc(oldId);
  const newRef = db.collection("events").doc(newId);
  const replacement = initialEvents.find((event) => event.id === newId);
  if (!replacement) throw new Error("15 lb event is missing from the catalog");

  const [oldEvent, newEvent, attempts, teams, brackets] = await Promise.all([
    oldRef.get(),
    newRef.get(),
    db.collection("attempts").where("eventId", "==", oldId).get(),
    db.collection("teams").where("eventId", "==", oldId).get(),
    db.collection("brackets").where("eventId", "==", oldId).get(),
  ]);
  if (!oldEvent.exists) throw new Error("Expected 10 lb event was not found");
  if (oldEvent.get("name") !== "Dumbbell Hold - 10 lb")
    throw new Error("10 lb event differs from the expected catalog record");
  if (attempts.size || teams.size || brackets.size)
    throw new Error("10 lb event has results or teams; migrate them manually before retiring it");
  if (newEvent.exists) throw new Error("15 lb event already exists; inspect it before running this migration");

  process.stdout.write(
    `Ready to create ${newId} and deactivate ${oldId} in ${projectId}/${databaseId}.\n`,
  );
  if (!apply) {
    process.stdout.write("Dry run only. Pass --apply to commit the two catalog changes.\n");
    return;
  }

  await db.runTransaction(async (transaction) => {
    const [currentOld, currentNew] = await Promise.all([
      transaction.get(oldRef),
      transaction.get(newRef),
    ]);
    if (!currentOld.exists || currentNew.exists || !currentOld.get("active"))
      throw new Error("Catalog changed during migration; no writes were made");

    const oldBefore = currentOld.data();
    const oldAudit = db.collection("audit").doc();
    const newAudit = db.collection("audit").doc();
    const { id: _id, ...newFields } = replacement;
    const oldAfter = { ...oldBefore, active: false, auditId: oldAudit.id };
    const newAfter = { ...newFields, auditId: newAudit.id };
    transaction.update(oldRef, { active: false, auditId: oldAudit.id });
    transaction.create(newRef, newAfter);
    transaction.create(oldAudit, {
      action: "saveEvent",
      entityType: "events",
      entityId: oldId,
      actorUid: "system:catalog-migration",
      actorName: "Catalog migration",
      at: FieldValue.serverTimestamp(),
      before: oldBefore,
      after: oldAfter,
      reason: "Replace the 10 lb dumbbell hold with a 15 lb division",
    });
    transaction.create(newAudit, {
      action: "initialSetup",
      entityType: "events",
      entityId: newId,
      actorUid: "system:catalog-migration",
      actorName: "Catalog migration",
      at: FieldValue.serverTimestamp(),
      before: null,
      after: newAfter,
      reason: "Add the approved 15 lb dumbbell hold division",
    });
  });
  process.stdout.write("15 lb event is active; 10 lb event is inactive.\n");
}

main().catch((error) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
