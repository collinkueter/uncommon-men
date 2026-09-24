import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { addBracketEntrant, advanceBracket, createBracket } from "../src/domain/ranking";

let environment: RulesTestEnvironment;
beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "uncommon-men-entrant-rules-test", firestore: {
    host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.rules", "utf8"),
  } });
});
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "events/cornhole"), { team: true, kind: "bracket" }),
      setDoc(doc(db, "identities/admin"), { name: "Admin" }),
      setDoc(doc(db, "identities/recorder"), { name: "Recorder" }),
      ...["a", "b", "c", "d"].map((id) => setDoc(doc(db, `teams/${id}`), { eventId: "cornhole" })),
      setDoc(doc(db, "teams/other"), { eventId: "foosball" }),
    ]);
  });
});
function stored(bracket: ReturnType<typeof createBracket>, auditId = "seed") {
  const { id: _, ...data } = bracket;
  return { ...data, auditId };
}
async function seed(data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), "brackets/cornhole-bracket"), data));
}
function update(before: Record<string, unknown>, data: Record<string, unknown>, admin = true, action = "addBracketTeam") {
  const uid = admin ? "admin" : "recorder";
  const db = environment.authenticatedContext(uid, { admin }).firestore();
  const after = { ...data, auditId: "change" };
  return writeBatch(db).set(doc(db, "brackets/cornhole-bracket"), after).set(doc(db, "audit/change"), {
    action, entityType: "brackets", entityId: "cornhole-bracket", actorUid: uid,
    actorName: admin ? "Admin" : "Recorder", at: serverTimestamp(), before, after, reason: "Entrant test",
  }).commit();
}
describe("bracket entrant rules", () => {
  it("allows admin additions with automatic byes and repeated additions", async () => {
    const three = addBracketEntrant(createBracket("cornhole", ["a", "b"]), "c");
    const before = stored(three);
    await seed(before);
    await assertSucceeds(update(before, stored(addBracketEntrant(three, "d"))));
  });
  it("allows untouched legacy brackets", async () => {
    const original = createBracket("cornhole", ["a", "b"]);
    const { entrantsOpen: _, ...before } = stored(original);
    await seed(before);
    await assertSucceeds(update(before, stored(addBracketEntrant(original, "c"))));
  });
  it("rejects nonadmin additions", async () => {
    const original = createBracket("cornhole", ["a", "b"]);
    const before = stored(original);
    await seed(before);
    await assertFails(update(before, stored(addBracketEntrant(original, "c")), false));
  });
  it("rejects additions after a result even if the caller forges an open flag", async () => {
    const original = createBracket("cornhole", ["a", "b", "c"]);
    const match = original.matches.find((m) => !m.bye && m.sideA && m.sideB)!;
    const played = advanceBracket(original, match.id, match.sideA!);
    const before = stored(played);
    await seed(before);
    await assertFails(update(before, stored({ ...addBracketEntrant(original, "d"), revision: played.revision + 1 })));
  });
  it("rejects wrong-event teams, duplicates, removals, and stale revisions", async () => {
    const original = createBracket("cornhole", ["a", "b"]);
    const before = stored(original);
    await seed(before);
    const valid = stored(addBracketEntrant(original, "c"));
    for (const invalid of [
      { ...valid, entrants: ["a", "b", "other"] },
      { ...valid, entrants: ["a", "b", "b"] },
      { ...valid, entrants: ["a", "c", "d"] },
      { ...valid, revision: 1 },
    ]) await assertFails(update(before, invalid));
  });
  it("closes additions on a normal nonadmin winner write", async () => {
    const original = createBracket("cornhole", ["a", "b"]);
    const before = stored(original);
    await seed(before);
    const after = { ...stored(advanceBracket(original, original.matches[0].id, "a")), lastMatchIndex: 0, lastParentIndex: -1 };
    await assertFails(update(before, { ...after, entrantsOpen: true }, false, "matchWinner"));
    await assertSucceeds(update(before, after, false, "matchWinner"));
  });
});
