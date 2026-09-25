import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { initialCategories, initialEvents } from "../src/domain/catalog";

const projectId = "uncommon-men";
const databaseId = "conference";
const eventId = "single-arm-bicep-curl-20-lb";
const apply = process.argv.includes("--apply");
type RecordData = Record<string, unknown>;

function catalogFields(record: RecordData): RecordData {
  const { id: _id, ...fields } = record;
  return fields;
}

function matchesCatalogEvent(existing: RecordData, expected: RecordData): boolean {
  const comparable = { ...existing };
  delete comparable.auditId;
  const expectedKeys = Object.keys(expected).sort();
  const existingKeys = Object.keys(comparable).sort();
  return expectedKeys.length === existingKeys.length &&
    expectedKeys.every((key, index) => key === existingKeys[index] && comparable[key] === expected[key]);
}

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const event = initialEvents.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error("20 lb single-arm bicep curl event is missing from the catalog");
  const category = initialCategories.find((candidate) => candidate.id === event.categoryId);
  if (!category) throw new Error(`Category ${event.categoryId} is missing from the catalog`);

  const eventRef = db.collection("events").doc(eventId);
  const categoryRef = db.collection("categories").doc(category.id);
  const [categorySnapshot, eventSnapshot] = await Promise.all([categoryRef.get(), eventRef.get()]);
  if (!categorySnapshot.exists) throw new Error(`Category ${category.id} was not found`);

  const expected = catalogFields(event);
  if (eventSnapshot.exists && !matchesCatalogEvent(eventSnapshot.data() as RecordData, expected)) {
    throw new Error(`Existing event ${eventId} differs from the expected catalog record`);
  }
  if (eventSnapshot.exists) {
    process.stdout.write(`Event ${eventId} already exists with the expected catalog record. No changes needed.\n`);
    return;
  }

  process.stdout.write(`Ready to create ${eventId} and its audit record in ${projectId}/${databaseId}.\n`);
  if (!apply) {
    process.stdout.write("Dry run only. Pass --apply to commit the event and audit record.\n");
    return;
  }

  await db.runTransaction(async (transaction) => {
    const [currentCategory, currentEvent] = await Promise.all([
      transaction.get(categoryRef),
      transaction.get(eventRef),
    ]);
    if (!currentCategory.exists) throw new Error(`Category ${category.id} was removed; no writes were made`);
    if (currentEvent.exists) {
      if (!matchesCatalogEvent(currentEvent.data() as RecordData, expected)) {
        throw new Error(`Existing event ${eventId} differs from the expected catalog record; no writes were made`);
      }
      return;
    }

    const auditRef = db.collection("audit").doc();
    const after = { ...expected, auditId: auditRef.id };
    transaction.create(eventRef, after);
    transaction.create(auditRef, {
      action: "initialSetup",
      entityType: "events",
      entityId: eventId,
      actorUid: "system:catalog-provisioning",
      actorName: "Catalog provisioning",
      at: FieldValue.serverTimestamp(),
      before: null,
      after,
      reason: "Add the approved 20 lb single-arm bicep curl event",
    });
  });
  process.stdout.write(`Created ${eventId} and its audit record.\n`);
}

main().catch((error) => {
  process.stderr.write(`Provisioning failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
