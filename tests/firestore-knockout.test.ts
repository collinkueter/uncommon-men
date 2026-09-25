import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { advanceBracket, createBracket } from "../src/domain/ranking";

let environment: RulesTestEnvironment;
const eventId = "lightning-knockout";
const gameId = `${eventId}-game`;
beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "uncommon-men-knockout-test", firestore: {
    host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.rules", "utf8"),
  } });
});
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `events/${eventId}`), { kind: "knockout", team: false, active: true }),
      setDoc(doc(db, "identities/player"), { name: "Player" }),
      setDoc(doc(db, "identities/admin"), { name: "Admin" }),
      ...["a", "b", "c"].map((id) => setDoc(doc(db, `participants/${id}`), { name: id })),
    ]);
  });
});
function draft(entrants = ["a"], revision = 1) {
  return { eventId, entrants, status: "registration", winnerId: null, revision };
}
async function seed(data: Record<string, unknown>) {
  const value = { ...data, auditId: "seed" };
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `games/${gameId}`), value));
  return value;
}
async function write(data: Record<string, unknown>, options: {
  before?: Record<string, unknown> | null; admin?: boolean; signedIn?: boolean;
  action?: string; reason?: string; id?: string; collection?: string; audited?: boolean;
} = {}) {
  const uid = options.admin ? "admin" : "player";
  const db = options.signedIn === false ? environment.unauthenticatedContext().firestore()
    : environment.authenticatedContext(uid, { admin: Boolean(options.admin) }).firestore();
  const id = options.id ?? gameId;
  const collection = options.collection ?? "games";
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = { ...data, auditId };
  const batch = writeBatch(db).set(doc(db, `${collection}/${id}`), after);
  if (options.audited !== false) batch.set(doc(db, `audit/${auditId}`), {
    action: options.action ?? "joinGame", entityType: collection, entityId: id,
    actorUid: uid, actorName: options.admin ? "Admin" : "Player", at: serverTimestamp(),
    before: options.before ?? null, after, reason: options.reason ?? "Game updated",
  });
  await batch.commit();
  return (await getDoc(doc(db, `${collection}/${id}`))).data()!;
}

describe("knockout game rules", () => {
  it("saves an open signup list and adds every entrant without matches", async () => {
    let before = await assertSucceeds(write(draft()));
    before = await assertSucceeds(write(draft(["a", "b"], 2), { before }));
    const after = await assertSucceeds(write(draft(["a", "b", "c"], 3), { before }));
    expect(after.entrants).toEqual(["a", "b", "c"]);
    expect(after).not.toHaveProperty("matches");
  });

  it("requires authentication, audit, canonical ID, and valid participants", async () => {
    await assertFails(write(draft(), { signedIn: false }));
    await assertFails(write(draft(), { audited: false }));
    await assertFails(write(draft(), { id: "another-game" }));
    await assertFails(write(draft(["missing"])));
    await assertFails(write(draft(["a", "b"])));
    await assertFails(write({ ...draft(), matches: [] }));
    await assertFails(write({ ...draft(), winnerId: "a" }));
  });

  it("rejects duplicate, reordered, removed, stale, and unknown entrants", async () => {
    const before = await seed(draft(["a", "b"], 2));
    for (const entrants of [["a", "b", "b"], ["b", "a", "c"], ["a"], ["a", "b", "missing"]]) {
      await assertFails(write(draft(entrants, 3), { before }));
    }
    await assertFails(write(draft(["a", "b", "c"], 2), { before }));
  });

  it("requires an active individual knockout event", async () => {
    for (const override of [{ active: false }, { kind: "bracket" }, { team: true }]) {
      await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `events/${eventId}`), { kind: "knockout", team: false, active: true, ...override }));
      await assertFails(write(draft()));
    }
  });

  it("lets an administrator start with the saved roster and closes signup", async () => {
    const one = await seed(draft());
    await assertFails(write({ ...draft(), status: "active", revision: 2 }, { before: one, admin: true, action: "startGame" }));
    const before = await seed(draft(["a", "b", "c"], 3));
    const active = { ...draft(["a", "b", "c"], 4), status: "active" };
    await assertFails(write(active, { before, action: "startGame" }));
    await assertFails(write({ ...active, entrants: ["a", "b"] }, { before, admin: true, action: "startGame" }));
    const started = await assertSucceeds(write(active, { before, admin: true, action: "startGame" }));
    await assertFails(write(draft(["a", "b", "c"], 5), { before: started }));
  });

  it("records exactly one registered winner only after start", async () => {
    const before = await seed(draft(["a", "b"], 2));
    const completed = { ...draft(["a", "b"], 3), status: "complete", winnerId: "a" };
    await assertFails(write(completed, { before, action: "gameWinner" }));
    const active = await seed({ ...draft(["a", "b"], 2), status: "active" });
    await assertFails(write({ ...completed, winnerId: "c" }, { before: active, action: "gameWinner" }));
    await assertFails(write({ ...completed, winnerId: ["a", "b"] }, { before: active, action: "gameWinner" }));
    const result = await assertSucceeds(write(completed, { before: active, action: "gameWinner" }));
    expect(result.winnerId).toBe("a");
    await assertFails(write({ ...completed, winnerId: "b" }, { before: result, action: "gameWinner" }));
  });

  it("requires administrator access and a reason to correct the winner", async () => {
    const before = await seed({ ...draft(["a", "b"], 3), status: "complete", winnerId: "a" });
    const after = { ...before, winnerId: "b", revision: 4 };
    await assertFails(write(after, { before, action: "gameWinner" }));
    await assertFails(write(after, { before, admin: true, action: "gameWinner", reason: "" }));
    await assertSucceeds(write(after, { before, admin: true, action: "gameWinner", reason: "Winner corrected by scorekeeper" }));
  });

  it("rejects numeric scores and old bracket result writes for knockout", async () => {
    await assertFails(write({ eventId, participantId: "a", value: 1, valid: true,
      recordedBy: "player", recorderName: "Player", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      revision: 1, requestId: "attempt-one",
    }, { collection: "attempts", id: "attempt-one", action: "attempt" }));
    const bracket = createBracket(eventId, ["a", "b"]);
    const { id, ...data } = bracket;
    const before = { ...data, auditId: "seed" };
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `brackets/${id}`), before));
    const { id: _, ...completed } = advanceBracket(bracket, bracket.matches[0].id, "a");
    await assertFails(write({ ...completed, lastMatchIndex: 0, lastParentIndex: -1 }, {
      before, collection: "brackets", id, action: "matchWinner",
    }));
  });
});
