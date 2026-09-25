import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = "uncommon-men";
const databaseId = "conference";
const eventId = "lightning-knockout";
const bracketId = eventId + "-bracket";
const gameId = eventId + "-game";
const apply = process.argv.includes("--apply");
type RecordData = Record<string, unknown>;

function assertRegistrationGame(data: RecordData) {
  if (data.eventId !== eventId ||
      !["registration", "active", "complete"].includes(String(data.status)) ||
      !Array.isArray(data.entrants) || new Set(data.entrants).size !== data.entrants.length ||
      (data.winnerId !== null && typeof data.winnerId !== "string"))
    throw new Error("Existing knockout game does not match the canonical shape");
  if (data.status === "complete" && !data.winnerId)
    throw new Error("Existing knockout game is complete without a winner");
  if (data.winnerId && !data.entrants.includes(data.winnerId))
    throw new Error("Existing knockout game winner is not registered");
}

async function main() {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app, databaseId);
  const eventRef = db.collection("events").doc(eventId);
  const bracketRef = db.collection("brackets").doc(bracketId);
  const gameRef = db.collection("games").doc(gameId);
  const attemptsQuery = db.collection("attempts").where("eventId", "==", eventId);
  const [eventSnapshot, bracketSnapshot, gameSnapshot, attemptsSnapshot] = await Promise.all([
    eventRef.get(), bracketRef.get(), gameRef.get(), attemptsQuery.get(),
  ]);
  if (!eventSnapshot.exists) throw new Error("Lightning / Knockout event was not found");
  const eventData = eventSnapshot.data() as RecordData;
  if (eventData.kind === "knockout") {
    if (gameSnapshot.exists) assertRegistrationGame(gameSnapshot.data() as RecordData);
    process.stdout.write(gameSnapshot.exists
      ? "Lightning / Knockout is already migrated; canonical game validated. No changes needed.\n"
      : "Lightning / Knockout is already a knockout event; no changes needed.\n");
    return;
  }
  if (eventData.kind !== "bracket") throw new Error("Unexpected event kind: " + String(eventData.kind));
  if (gameSnapshot.exists) throw new Error("Canonical knockout game already exists; inspect it before migrating");
  if (attemptsSnapshot.size) throw new Error("Lightning / Knockout has attempts; migration is unsafe");
  const bracket = bracketSnapshot.data() as RecordData | undefined;
  if (bracketSnapshot.exists && (!bracket || !Array.isArray(bracket.entrants) || !Array.isArray(bracket.matches)))
    throw new Error("Legacy bracket is missing registration data; migration is unsafe");
  const entrants = bracket && Array.isArray(bracket.entrants) ? [...bracket.entrants] : [];
  const matches = bracket && Array.isArray(bracket.matches) ? bracket.matches as RecordData[] : [];
  if (bracket && !["registration", "active"].includes(String(bracket.status))) throw new Error("Legacy bracket is complete or has an unexpected status");
  if (matches.some((match) => match.bye !== true && match.winnerId !== null && match.winnerId !== undefined)) throw new Error("Legacy bracket has a played result; migrate it manually");
  if (entrants.length > 128 || new Set(entrants).size !== entrants.length || entrants.some((id) => typeof id !== "string" || !id)) throw new Error("Legacy bracket has invalid entrants");
  process.stdout.write(entrants.length ? "Ready to migrate " + entrants.length + " registered entrant(s) to " + gameId + ".\n" : "Legacy registration has no entrants; only the event catalog will be updated.\n");
  if (!apply) { process.stdout.write("Dry run only. Pass --apply to commit the event update and game creation.\n"); return; }

  await db.runTransaction(async (transaction) => {
    const currentEvent = await transaction.get(eventRef);
    const currentBracket = await transaction.get(bracketRef);
    const currentGame = await transaction.get(gameRef);
    const currentAttempts = await transaction.get(attemptsQuery);
    if (!currentEvent.exists || currentGame.exists || currentAttempts.size || currentBracket.exists !== bracketSnapshot.exists)
      throw new Error("Migration inputs changed during validation; no writes were made");
    const currentEventData = currentEvent.data() as RecordData;
    const currentBracketData = currentBracket.exists ? currentBracket.data() as RecordData : null;
    const currentEntrants = currentBracketData && Array.isArray(currentBracketData.entrants) ? [...currentBracketData.entrants] : [];
    const currentMatches = currentBracketData && Array.isArray(currentBracketData.matches) ? currentBracketData.matches as RecordData[] : [];
    if (currentEventData.kind !== "bracket" ||
        (currentBracketData && (!Array.isArray(currentBracketData.entrants) || !Array.isArray(currentBracketData.matches) || !['registration', 'active'].includes(String(currentBracketData.status)) || currentMatches.some((match) => match.bye !== true && match.winnerId !== null && match.winnerId !== undefined))))
      throw new Error("Migration inputs changed during validation; no writes were made");
    if (currentEntrants.length > 128 || new Set(currentEntrants).size !== currentEntrants.length || currentEntrants.some((id) => typeof id !== "string" || !id))
      throw new Error("Migration inputs changed during validation; no writes were made");
    const participantRefs = currentEntrants.map((id) => db.collection("participants").doc(id));
    const participantSnapshots = await Promise.all(participantRefs.map((ref) => transaction.get(ref)));
    if (participantSnapshots.some((snapshot) => !snapshot.exists))
      throw new Error("A registered entrant no longer exists; no writes were made");

    const eventAuditRef = db.collection("audit").doc();
    const eventAfter = {
      ...currentEventData,
      kind: "knockout",
      unit: "winner",
      instructions: String(currentEventData.instructions ?? "") + " Everyone signs up before play starts. The last player standing is the winner.",
      auditId: eventAuditRef.id,
    };
    transaction.update(eventRef, {
      kind: "knockout", unit: "winner", instructions: eventAfter.instructions, auditId: eventAuditRef.id,
    });
    transaction.create(eventAuditRef, {
      action: "saveEvent", entityType: "events", entityId: eventId,
      actorUid: "system:catalog-migration", actorName: "Catalog migration",
      at: FieldValue.serverTimestamp(), before: currentEventData, after: eventAfter,
      reason: "Migrate Lightning / Knockout from legacy bracket registration to a single knockout game",
    });
    if (currentEntrants.length) {
      const gameAuditRef = db.collection("audit").doc();
      const gameAfter = {
        eventId, entrants: currentEntrants, status: "registration",
        winnerId: null, revision: 1, auditId: gameAuditRef.id,
      };
      transaction.create(gameRef, gameAfter);
      transaction.create(gameAuditRef, {
        action: "initialSetup", entityType: "games", entityId: gameId,
        actorUid: "system:catalog-migration", actorName: "Catalog migration",
        at: FieldValue.serverTimestamp(), before: null, after: gameAfter,
        reason: "Preserve legacy Lightning / Knockout registration entrants in the canonical knockout game",
      });
    }
  });
  process.stdout.write("Lightning / Knockout migration applied; the legacy bracket document was preserved and is ignored by knockout rules.\n");
}

main().catch((error) => {
  process.stderr.write("Migration failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
