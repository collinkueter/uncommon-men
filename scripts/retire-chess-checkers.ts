import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = "uncommon-men";
const databaseId = "conference";
const retiredIds = ["chess", "checkers"];
const apply = process.argv.includes("--apply");

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const refs = retiredIds.map((id) => db.collection("events").doc(id));

  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  const toRetire = snapshots.filter((snapshot) => snapshot.exists && snapshot.get("active"));
  for (const snapshot of snapshots) {
    const [attempts, brackets] = await Promise.all([
      db.collection("attempts").where("eventId", "==", snapshot.id).get(),
      db.collection("brackets").where("eventId", "==", snapshot.id).get(),
    ]);
    process.stdout.write(
      `${snapshot.id}: ${snapshot.exists ? (snapshot.get("active") ? "active" : "inactive") : "missing"}, ` +
        `${attempts.size} attempts, ${brackets.size} brackets (kept as history)\n`,
    );
  }
  if (!toRetire.length) {
    process.stdout.write("Nothing to retire.\n");
    return;
  }
  if (!apply) {
    process.stdout.write("Dry run only. Pass --apply to deactivate these events.\n");
    return;
  }

  await db.runTransaction(async (transaction) => {
    const current = await Promise.all(toRetire.map((snapshot) => transaction.get(snapshot.ref)));
    for (const snapshot of current) {
      if (!snapshot.exists || !snapshot.get("active"))
        throw new Error("Catalog changed during migration; no writes were made");
      const before = snapshot.data();
      const audit = db.collection("audit").doc();
      transaction.update(snapshot.ref, { active: false, auditId: audit.id });
      transaction.create(audit, {
        action: "saveEvent",
        entityType: "events",
        entityId: snapshot.id,
        actorUid: "system:catalog-migration",
        actorName: "Catalog migration",
        at: FieldValue.serverTimestamp(),
        before,
        after: { ...before, active: false, auditId: audit.id },
        reason: "Remove chess and checkers from the competition",
      });
    }
  });
  process.stdout.write(`Deactivated ${toRetire.map((snapshot) => snapshot.id).join(" and ")}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
