import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initialEvents } from "../src/domain/catalog";
import eventInstructions from "../src/domain/eventInstructions.json";

const projectId = "uncommon-men";
const databaseId = "conference";
const apply = process.argv.includes("--apply");
const actorUid = "system:event-instructions-sync";
const actorName = "Event instructions sync";
const reason = "Sync canonical HOW TO PLAY instructions from the approved event guide";
type RecordData = Record<string, unknown>;
const canonicalInstructions = eventInstructions as Record<string, string>;

function expectedInstructions(eventId: string): string {
  const instructions = canonicalInstructions[eventId];
  if (!instructions) throw new Error(`Canonical instructions are missing for ${eventId}`);
  return instructions;
}

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const events = initialEvents.map((event) => ({ id: event.id, instructions: expectedInstructions(event.id) }));
  if (events.length !== 16) throw new Error(`Expected 16 canonical events, found ${events.length}`);

  const refs = events.map(({ id }) => db.collection("events").doc(id));
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  if (snapshots.some((snapshot) => !snapshot.exists)) {
    const missing = snapshots
      .map((snapshot, index) => snapshot.exists ? null : events[index].id)
      .filter((id): id is string => id !== null);
    throw new Error(`Canonical event document(s) missing: ${missing.join(", ")}`);
  }

  const changes = events.filter(({ instructions }, index) =>
    String(snapshots[index].data()?.instructions ?? "") !== instructions,
  );
  process.stdout.write(`${changes.length} of ${events.length} event instructions need syncing.\n`);
  for (const { id } of changes) process.stdout.write(`- ${id}\n`);
  if (!changes.length) {
    process.stdout.write("All event instructions already match the canonical guide. No changes needed.\n");
    return;
  }
  if (!apply) {
    process.stdout.write("Dry run only. Pass --apply to commit the instruction updates and audit records.\n");
    return;
  }

  for (const { id, instructions } of changes) {
    const eventRef = db.collection("events").doc(id);
    await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(eventRef);
      if (!currentSnapshot.exists) throw new Error(`Event ${id} was removed during sync; no update was made`);
      const before = currentSnapshot.data() as RecordData;
      if (String(before.instructions ?? "") === instructions) return;

      const auditRef = db.collection("audit").doc();
      const after = { ...before, instructions, auditId: auditRef.id };
      transaction.update(eventRef, { instructions, auditId: auditRef.id });
      transaction.create(auditRef, {
        action: "saveEvent",
        entityType: "events",
        entityId: id,
        actorUid,
        actorName,
        at: FieldValue.serverTimestamp(),
        before,
        after,
        reason,
      });
    });
    process.stdout.write(`Synced ${id}.\n`);
  }
  process.stdout.write("Event instruction sync applied.\n");
}

main().catch((error) => {
  process.stderr.write(`Event instruction sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
