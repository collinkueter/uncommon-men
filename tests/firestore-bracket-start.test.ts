import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { advanceBracket, createBracket } from "../src/domain/ranking";

let environment: RulesTestEnvironment;
const eventId = "carpet-ball";
const bracketId = `${eventId}-bracket`;

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "uncommon-men-start-rules-test", firestore: { host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.rules", "utf8") } });
});
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `events/${eventId}`), { categoryId: "cat", name: "Carpet Ball", kind: "bracket", direction: "higher", unit: "wins", team: false, teamSize: 0, instructions: "", active: true }),
      setDoc(doc(db, "identities/player"), { name: "Player" }),
      setDoc(doc(db, "identities/admin"), { name: "Admin" }),
      ...Array.from({ length: 130 }, (_, i) => setDoc(doc(db, `participants/p${i + 1}`), { name: `P${i + 1}` })),
    ]);
  });
});
function db(uid = "player", admin = false) { return environment.authenticatedContext(uid, { admin }).firestore(); }
function registration(entrants: string[] = [], revision = 1) { return { eventId, entrants, matches: [], status: "registration", revision, entrantsOpen: true }; }
function bracketWrite(data: Record<string, unknown>, o: { uid?: string; signedIn?: boolean; admin?: boolean; action?: string; id?: string; auditId?: string; before?: Record<string, unknown> | null } = {}) {
  const uid = o.uid ?? "player"; const id = o.id ?? bracketId; const auditId = o.auditId ?? `audit-${Math.random().toString(36).slice(2)}`; const after = { ...data, auditId };
  const actorDb = o.signedIn === false ? environment.unauthenticatedContext().firestore() : db(uid, o.admin ?? false);
  const batch = writeBatch(actorDb).set(doc(actorDb, `brackets/${id}`), after);
  if (auditId) batch.set(doc(actorDb, `audit/${auditId}`), { action: o.action ?? "joinBracket", entityType: "brackets", entityId: id, actorUid: uid, actorName: uid === "admin" ? "Admin" : "Player", at: serverTimestamp(), before: o.before ?? null, after, reason: o.action === "startBracket" ? "Bracket started" : "Joined bracket" });
  return batch.commit();
}
async function seed(data: Record<string, unknown>) { await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `brackets/${bracketId}`), data)); }
async function setTeamEvent() { await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `events/${eventId}`), { categoryId: "cat", name: "Teams", kind: "bracket", direction: "higher", unit: "wins", team: true, teamSize: 2, instructions: "", active: true })); }
function teamJoin(includeRegistration = true, admin = false, teamId = "team-1") {
  const actorUid = admin ? "admin" : "player"; const actorName = admin ? "Admin" : "Player"; const actorDb = db(actorUid, admin); const team = { eventId, name: "The Pair", memberIds: ["p1", "p2"], auditId: `team-audit-${teamId}` }; const bracket = { ...registration([teamId]), auditId: `join-audit-${teamId}` };
  const batch = writeBatch(actorDb).set(doc(actorDb, `teams/${teamId}`), team).set(doc(actorDb, `audit/team-audit-${teamId}`), { action: "saveTeam", entityType: "teams", entityId: teamId, actorUid, actorName, at: serverTimestamp(), before: null, after: team, reason: "Team saved" });
  if (includeRegistration) batch.set(doc(actorDb, `brackets/${bracketId}`), bracket).set(doc(actorDb, `audit/join-audit-${teamId}`), { action: "joinBracket", entityType: "brackets", entityId: bracketId, actorUid, actorName, at: serverTimestamp(), before: null, after: bracket, reason: "Joined bracket" });
  return batch.commit();
}

describe("bracket registration rules", () => {
  it("creates canonical registration and appends more than two entrants sequentially", async () => {
    await assertSucceeds(bracketWrite(registration(["p1"])));
    const before1 = { ...registration(["p1"], 1), auditId: "seed-1" }; await seed(before1);
    const after2 = registration(["p1", "p2"], 2); await assertSucceeds(bracketWrite(after2, { before: before1 }));
    const before2 = { ...after2, auditId: "seed-2" }; await seed(before2);
    await assertSucceeds(bracketWrite(registration(["p1", "p2", "p3"], 3), { before: before2 }));
  });
  it("rejects anonymous, unaudited, invalid-event, and invalid-participant joins", async () => {
    await assertFails(bracketWrite(registration(["p1"]), { signedIn: false }));
    await assertFails(bracketWrite(registration(["p1"]), { auditId: "" }));
    await assertFails(bracketWrite(registration(["missing"])));
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `events/${eventId}`), { active: false, kind: "bracket", team: false }));
    await assertFails(bracketWrite(registration(["p1"])));
  });
  it("enforces canonical id, exact append, duplicate rejection, and max 128", async () => {
    await assertFails(bracketWrite(registration(["p1"]), { id: "other" }));
    const before = { ...registration(["p1", "p2"], 2), auditId: "seed" }; await seed(before);
    await assertFails(bracketWrite(registration(["p1", "p2"], 3), { before }));
    await assertFails(bracketWrite(registration(["p2", "p1", "p3"], 3), { before }));
    await assertFails(bracketWrite(registration(["p1"], 3), { before }));
    const entrants = Array.from({ length: 128 }, (_, i) => `p${i + 1}`); const full = { ...registration(entrants, 128), auditId: "full" }; await seed(full);
    await assertFails(bracketWrite(registration([...entrants, "p129"], 129), { before: full }));
  });
  it("rejects forged matches, stale revisions, and reverting active or completed brackets", async () => {
    const before = { ...registration(["p1", "p2"], 2), auditId: "seed" }; await seed(before);
    await assertFails(bracketWrite({ ...registration(["p1", "p2", "p3"], 3), matches: [{ id: "fake" }] }, { before }));
    await assertFails(bracketWrite(registration(["p1", "p2", "p3"], 2), { before }));
    const activeBefore = { ...before, status: "active", matches: [{ id: "x" }], auditId: "active" }; await seed(activeBefore); await assertFails(bracketWrite(registration(["p1", "p2", "p3"], 3), { before: activeBefore }));
    const completeBefore = { ...before, status: "complete", matches: [{ id: "x" }], auditId: "complete" }; await seed(completeBefore); await assertFails(bracketWrite(registration(["p1", "p2", "p3"], 3), { before: completeBefore }));
  });
  it("starts from registration with same entrants and increments revision", async () => {
    const before = { ...registration(["p1", "p2", "p3"], 3), auditId: "seed" }; await seed(before); const { id: _id, ...started } = createBracket(eventId, before.entrants);
    await assertFails(bracketWrite({ ...started, revision: before.revision + 1 }, { action: "startBracket", before }));
    await assertSucceeds(bracketWrite({ ...started, revision: before.revision + 1 }, { uid: "admin", admin: true, action: "startBracket", before }));
    await assertFails(bracketWrite(registration(["p1", "p2", "p3", "p4"], 4), { before }));
  });
  it("preserves legacy direct admin creation", async () => { const { id: _id, ...data } = createBracket(eventId, ["p1", "p2", "p3"]); await assertSucceeds(bracketWrite(data, { uid: "admin", admin: true, action: "startBracket" })); });
  it("allows an admin participant addition before results, denies public additions, and locks after a result", async () => {
    const original = createBracket(eventId, ["p1", "p2"]); const { id: _originalId, ...originalStored } = original; const before = { ...originalStored, auditId: "active-seed" }; await seed(before);
    const expanded = createBracket(eventId, ["p1", "p2", "p3"]); const { id: _expandedId, ...expandedStored } = expanded;
    await assertSucceeds(bracketWrite({ ...expandedStored, revision: before.revision + 1 }, { uid: "admin", admin: true, action: "addBracketParticipant", before }));
    await seed(before);
    await assertFails(bracketWrite({ ...expandedStored, revision: before.revision + 1 }, { action: "addBracketParticipant", before }));
    const played = advanceBracket(original, original.matches.find((match) => match.sideA && match.sideB)!.id, "p1");
    const { id: _playedId, ...playedStored } = played; const playedBefore = { ...playedStored, auditId: "played" }; await seed(playedBefore);
    const { id: _lateId, ...lateStored } = createBracket(eventId, ["p1", "p2", "p3"]);
    await assertFails(bracketWrite({ ...lateStored, revision: played.revision + 1 }, { uid: "admin", admin: true, action: "addBracketParticipant", before: playedBefore }));
  });
  it("does not allow a public result write while registration is still a draft", async () => {
    const before = { ...registration(["p1", "p2"], 2), auditId: "draft" }; await seed(before);
    await assertFails(bracketWrite({ ...before, matches: [{ id: "fake" }], revision: 3 }, { action: "matchWinner", before }));
  });
  it("atomically creates a team and joins it, while requiring registration draft", async () => {
    await setTeamEvent(); await assertSucceeds(teamJoin()); await environment.clearFirestore(); await setTeamEvent();
    await environment.withSecurityRulesDisabled(async (context) => { const x = context.firestore(); await setDoc(doc(x, "identities/player"), { name: "Player" }); await setDoc(doc(x, "participants/p1"), { name: "P1" }); await setDoc(doc(x, "participants/p2"), { name: "P2" }); });
    await assertFails(teamJoin(false, false, "team-2"));
  });
  it("rejects a team belonging to another event", async () => {
    await setTeamEvent();
    await environment.withSecurityRulesDisabled(async (context) => {
      const x = context.firestore(); await setDoc(doc(x, "events/other-event"), { ...{ categoryId: "cat", name: "Other", kind: "bracket", direction: "higher", unit: "wins", team: true, teamSize: 2, instructions: "", active: true } });
      await setDoc(doc(x, "teams/foreign"), { eventId: "other-event", name: "Foreign", memberIds: ["p1", "p2"] });
    });
    await assertFails(bracketWrite(registration(["foreign"]), { auditId: "wrong-team" }));
  });
  it("keeps both entrants when two users join concurrently", async () => {
    await seed({ ...registration(["p1"], 1), auditId: "seed" });
    const join = async (uid: string, entrant: string, auditId: string) => {
      const actorDb = db(uid); const target = doc(actorDb, `brackets/${bracketId}`); const audit = doc(actorDb, `audit/${auditId}`);
      await runTransaction(actorDb, async (tx) => {
        const snapshot = await tx.get(target); const before = snapshot.data()!; const after = { ...before, entrants: [...before.entrants, entrant], revision: before.revision + 1, auditId };
        tx.set(target, after); tx.set(audit, { action: "joinBracket", entityType: "brackets", entityId: bracketId, actorUid: uid, actorName: uid === "admin" ? "Admin" : "Player", at: serverTimestamp(), before, after, reason: "Joined bracket" });
      });
    };
    const results = await Promise.allSettled([join("player", "p2", "concurrent-2"), join("player", "p3", "concurrent-3")]);
    for (const [index, result] of results.entries()) if (result.status === "rejected") await join("player", index === 0 ? "p2" : "p3", index === 0 ? "concurrent-2-retry" : "concurrent-3-retry");
    const snapshot = await getDoc(doc(db("player"), `brackets/${bracketId}`));
    expect(snapshot.data()?.entrants).toHaveLength(3);
    expect(snapshot.data()?.entrants[0]).toBe("p1");
    expect(new Set(snapshot.data()?.entrants.slice(1))).toEqual(new Set(["p2", "p3"]));
  });
  it("denies public team signup after start and permits admin team creation outside it", async () => {
    await setTeamEvent(); const { id: _id, ...started } = createBracket(eventId, ["team-0", "team-1"]);
    await environment.withSecurityRulesDisabled(async (context) => { const x = context.firestore(); await setDoc(doc(x, "teams/team-0"), { eventId, name: "Existing", memberIds: ["p1", "p2"] }); await setDoc(doc(x, `brackets/${bracketId}`), { ...started, auditId: "active" }); });
    await assertFails(teamJoin()); await assertSucceeds(teamJoin(false, true));
  });
});
