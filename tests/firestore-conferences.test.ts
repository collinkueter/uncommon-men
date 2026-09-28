import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { conferenceDoc, seedConference } from "./conference";

// Multi-conference isolation and role storage: platform organizers, conference
// admins stored by verified Google email, draft visibility and archived locks.
let environment: RulesTestEnvironment;
const A = "conf-a";
const B = "conf-b";

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "uncommon-men-conferences-test",
    firestore: { host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(async () => environment.cleanup());

const users = {
  claim: { uid: "claim-admin", token: { admin: true } },
  organizer: { uid: "organizer", token: { email: "Randy@Example.com", email_verified: true } },
  adminA: { uid: "admin-a", token: { email: "a-admin@example.com", email_verified: true } },
  unverified: { uid: "unverified", token: { email: "randy@example.com", email_verified: false } },
  recorder: { uid: "recorder", token: {} },
} as const;
type User = keyof typeof users;
const dbFor = (user: User) => environment.authenticatedContext(users[user].uid, users[user].token).firestore();
const actorName = (user: User) => ("email" in users[user].token ? String((users[user].token as { email: string }).email) : user);

beforeEach(async () => {
  await environment.clearFirestore();
  await seedConference(environment, A);
  await seedConference(environment, B);
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes = [
      setDoc(doc(db, "platformRoles", "randy@example.com"), { role: "organizer", auditId: "seed-organizer" }),
      setDoc(doc(db, "conferences", A, "admins", "a-admin@example.com"), { email: "a-admin@example.com", auditId: "seed-admin-a" }),
    ];
    for (const cid of [A, B])
      for (const user of Object.keys(users) as User[])
        writes.push(setDoc(doc(db, "conferences", cid, "identities", users[user].uid), {
          uid: users[user].uid, name: user, participantId: null, auditId: `seed-${user}`,
        }));
    await Promise.all(writes);
  });
});

function categoryWrite(user: User, cid: string, id = "strength") {
  const db = dbFor(user);
  const target = doc(db, "conferences", cid, "categories", id);
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = { name: "Strength", group: "physical", order: 1, auditId };
  return writeBatch(db).set(target, after).set(doc(db, "conferences", cid, "audit", auditId), {
    action: "saveCategory", entityType: "categories", entityId: id, actorUid: users[user].uid,
    actorName: user, at: serverTimestamp(), before: null, after, reason: "Setup",
  }).commit();
}

function participantWrite(user: User, cid: string) {
  const db = dbFor(user);
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = { name: "Marcus Reed", normalizedName: "marcus reed", auditId };
  return writeBatch(db).set(doc(db, "conferences", cid, "participants", "name-marcus"), after)
    .set(doc(db, "conferences", cid, "audit", auditId), {
      action: "addParticipant", entityType: "participants", entityId: "name-marcus", actorUid: users[user].uid,
      actorName: user, at: serverTimestamp(), before: null, after, reason: "Joined",
    }).commit();
}

async function conferenceWrite(user: User, cid: string, changes: Record<string, unknown>, create = false) {
  const db = dbFor(user);
  const ref = doc(db, "conferences", cid);
  let before: Record<string, unknown> | null = null;
  if (!create)
    await environment.withSecurityRulesDisabled(async (context) => {
      before = (await getDoc(doc(context.firestore(), "conferences", cid))).data() ?? null;
    });
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = create
    ? { ...conferenceDoc(cid, "draft"), createdAt: serverTimestamp(), ...changes, auditId }
    : { ...(before as Record<string, unknown> | null), ...changes, auditId };
  return writeBatch(db).set(ref, after).set(doc(db, "conferences", cid, "audit", auditId), {
    action: create ? "createConference" : "saveConference", entityType: "conference", entityId: cid,
    actorUid: users[user].uid, actorName: actorName(user), at: serverTimestamp(), before, after, reason: "Conference setup",
  }).commit();
}

function settingsWrite(user: User, defaultConferenceId: string) {
  const db = dbFor(user);
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = { defaultConferenceId, auditId };
  return writeBatch(db).set(doc(db, "settings", "platform"), after).set(doc(db, "platformAudit", auditId), {
    action: "setDefaultConference", entityType: "settings", entityId: "platform", actorUid: users[user].uid,
    actorName: actorName(user), at: serverTimestamp(), before: null, after, reason: "Default conference",
  }).commit();
}

function grantOrganizer(user: User, email: string) {
  const db = dbFor(user);
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = { role: "organizer", auditId };
  return writeBatch(db).set(doc(db, "platformRoles", email), after).set(doc(db, "platformAudit", auditId), {
    action: "grantOrganizer", entityType: "platformRoles", entityId: email, actorUid: users[user].uid,
    actorName: actorName(user), at: serverTimestamp(), before: null, after, reason: "New organizer",
  }).commit();
}

function grantConferenceAdmin(user: User, cid: string, email: string) {
  const db = dbFor(user);
  const auditId = `audit-${crypto.randomUUID()}`;
  const after = { email, auditId };
  return writeBatch(db).set(doc(db, "conferences", cid, "admins", email), after).set(doc(db, "conferences", cid, "audit", auditId), {
    action: "grantAdmin", entityType: "admins", entityId: email, actorUid: users[user].uid,
    actorName: actorName(user), at: serverTimestamp(), before: null, after, reason: "New conference admin",
  }).commit();
}

describe("conference isolation", () => {
  it("scopes a conference admin to their own conference; organizers reach every conference", async () => {
    await assertSucceeds(categoryWrite("adminA", A));
    await assertFails(categoryWrite("adminA", B));
    await assertSucceeds(categoryWrite("organizer", B));
    await assertSucceeds(categoryWrite("claim", B, "claim-strength"));
    await assertFails(categoryWrite("recorder", A, "recorder-strength"));
  });

  it("does not let an audit entry in one conference vouch for a write in another", async () => {
    const db = dbFor("adminA");
    const auditId = "cross-audit";
    const after = { name: "Strength", group: "physical", order: 1, auditId };
    await assertFails(writeBatch(db).set(doc(db, "conferences", B, "categories", "strength"), after)
      .set(doc(db, "conferences", A, "audit", auditId), {
        action: "saveCategory", entityType: "categories", entityId: "strength", actorUid: users.adminA.uid,
        actorName: "adminA", at: serverTimestamp(), before: null, after, reason: "Setup",
      }).commit());
  });

  it("gives an unverified email neither organizer nor conference-admin access", async () => {
    await assertFails(categoryWrite("unverified", A));
    await assertFails(categoryWrite("unverified", B));
    await assertFails(getDocs(collection(dbFor("unverified"), "conferences", A, "audit")));
    await assertFails(getDoc(doc(dbFor("unverified"), "platformRoles", "randy@example.com")));
    await assertFails(settingsWrite("unverified", A));
  });

  it("lets conference admins read only their own conference audit log", async () => {
    await assertSucceeds(getDocs(collection(dbFor("adminA"), "conferences", A, "audit")));
    await assertFails(getDocs(collection(dbFor("adminA"), "conferences", B, "audit")));
    await assertSucceeds(getDocs(collection(dbFor("organizer"), "conferences", B, "audit")));
  });
});

describe("role storage", () => {
  it("lets people read their own role documents but not anyone else's", async () => {
    await assertSucceeds(getDoc(doc(dbFor("adminA"), "conferences", A, "admins", "a-admin@example.com")));
    await assertFails(getDoc(doc(dbFor("adminA"), "platformRoles", "randy@example.com")));
    await assertSucceeds(getDoc(doc(dbFor("organizer"), "platformRoles", "randy@example.com")));
    await assertFails(getDoc(doc(dbFor("recorder"), "conferences", A, "admins", "a-admin@example.com")));
  });

  it("lets only organizers grant organizer and conference-admin roles", async () => {
    await assertFails(grantOrganizer("adminA", "new@example.com"));
    await assertFails(grantOrganizer("recorder", "new@example.com"));
    await assertFails(grantOrganizer("organizer", "Mixed@Example.com"));
    await assertSucceeds(grantOrganizer("organizer", "new@example.com"));
    await assertFails(grantConferenceAdmin("adminA", A, "helper@example.com"));
    await assertSucceeds(grantConferenceAdmin("organizer", A, "helper@example.com"));
    await assertSucceeds(grantConferenceAdmin("claim", B, "helper@example.com"));
  });

  it("requires an audited revoke to delete a role", async () => {
    const db = dbFor("organizer");
    const ref = doc(db, "conferences", A, "admins", "a-admin@example.com");
    await assertFails(deleteDoc(ref));
    const before = { email: "a-admin@example.com", auditId: "seed-admin-a" };
    await assertSucceeds(writeBatch(db).delete(ref).set(doc(db, "conferences", A, "audit", "seed-admin-a-revoke"), {
      action: "revokeAdmin", entityType: "admins", entityId: "a-admin@example.com", actorUid: users.organizer.uid,
      actorName: actorName("organizer"), at: serverTimestamp(), before, after: null, reason: "Role ended",
    }).commit());
    await assertFails(categoryWrite("adminA", A));

    const platformRef = doc(db, "platformRoles", "randy@example.com");
    await assertFails(deleteDoc(platformRef));
    await assertSucceeds(writeBatch(db).delete(platformRef).set(doc(db, "platformAudit", "seed-organizer-revoke"), {
      action: "revokeOrganizer", entityType: "platformRoles", entityId: "randy@example.com", actorUid: users.organizer.uid,
      actorName: actorName("organizer"), at: serverTimestamp(), before: { role: "organizer", auditId: "seed-organizer" },
      after: null, reason: "Stepped down",
    }).commit());
    await assertFails(categoryWrite("organizer", B, "after-revoke"));
  });

  it("allows only organizers to change the platform default conference", async () => {
    await assertFails(settingsWrite("adminA", A));
    await assertFails(settingsWrite("recorder", A));
    await assertFails(settingsWrite("organizer", "missing-conference"));
    await assertSucceeds(settingsWrite("organizer", B));
    await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), "settings", "platform")));
    await assertFails(getDocs(collection(dbFor("adminA"), "platformAudit")));
    await assertSucceeds(getDocs(collection(dbFor("organizer"), "platformAudit")));
  });
});

describe("conference documents", () => {
  it("lets organizers create conferences and change status; conference admins edit details only", async () => {
    await assertFails(conferenceWrite("adminA", "new-conf", {}, true));
    await assertFails(conferenceWrite("recorder", "new-conf", {}, true));
    await assertFails(conferenceWrite("organizer", "Bad_Slug", { slug: "Bad_Slug" }, true));
    await assertSucceeds(conferenceWrite("organizer", "new-conf", {}, true));
    await assertSucceeds(conferenceWrite("adminA", A, { name: "Renamed", location: "New hall" }));
    await assertFails(conferenceWrite("adminA", A, { status: "archived" }));
    await assertFails(conferenceWrite("adminA", B, { name: "Not mine" }));
    await assertSucceeds(conferenceWrite("organizer", A, { status: "archived" }));
    await assertFails(conferenceWrite("adminA", A, { name: "Archived rename" }));
    await assertSucceeds(conferenceWrite("organizer", A, { status: "live" }));
  });

  it("hides draft conferences and their data from everyone but their admins", async () => {
    await seedConference(environment, A, "draft");
    const anonymous = environment.unauthenticatedContext().firestore();
    for (const db of [anonymous, dbFor("recorder"), dbFor("unverified")]) {
      await assertFails(getDoc(doc(db, "conferences", A)));
      await assertFails(getDocs(collection(db, "conferences", A, "events")));
    }
    await assertSucceeds(getDoc(doc(dbFor("adminA"), "conferences", A)));
    await assertSucceeds(getDocs(collection(dbFor("adminA"), "conferences", A, "events")));
    await assertSucceeds(getDocs(collection(dbFor("organizer"), "conferences", A, "events")));
    await assertSucceeds(getDocs(collection(anonymous, "conferences", B, "events")));
    await assertFails(participantWrite("recorder", A));
    await assertSucceeds(participantWrite("adminA", A));
  });

  it("reports a missing conference as not found instead of denying the read", async () => {
    const snapshot = await assertSucceeds(getDoc(doc(environment.unauthenticatedContext().firestore(), "conferences", "nope")));
    if (snapshot.exists()) throw new Error("Expected a missing conference");
    await assertFails(participantWrite("recorder", "nope"));
  });

  it("keeps archived conferences readable and rejects every subcollection write", async () => {
    await seedConference(environment, A, "archived");
    const anonymous = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anonymous, "conferences", A)));
    await assertSucceeds(getDocs(collection(anonymous, "conferences", A, "events")));
    await assertFails(participantWrite("recorder", A));
    await assertFails(categoryWrite("adminA", A));
    await assertFails(categoryWrite("organizer", A));
    await assertFails(categoryWrite("claim", A));
    await assertFails(grantConferenceAdmin("organizer", A, "helper@example.com"));
    const db = dbFor("recorder");
    await assertFails(setDoc(doc(db, "conferences", A, "identities", users.recorder.uid), {
      uid: users.recorder.uid, name: "Renamed", participantId: null, auditId: "x",
    }));
    await assertSucceeds(participantWrite("recorder", B));
  });
});

describe("legacy top-level collections", () => {
  const legacy = ["categories", "events", "participants", "teams", "attempts", "brackets", "games", "identities", "audit"];
  beforeEach(async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all(legacy.map((name) => setDoc(doc(db, name, "legacy-doc"), { name: "Legacy", auditId: "legacy" })));
      await setDoc(doc(db, "identities", users.recorder.uid), { uid: users.recorder.uid, name: "R", participantId: null, auditId: "x" });
    });
  });

  it("are neither readable nor writable by any client after the migration, whatever the role", async () => {
    const clients = [environment.unauthenticatedContext().firestore(), ...(Object.keys(users) as User[]).map(dbFor)];
    for (const db of clients)
      for (const name of legacy) {
        await assertFails(getDoc(doc(db, name, "legacy-doc")));
        await assertFails(getDocs(collection(db, name)));
        await assertFails(setDoc(doc(db, name, "new-doc"), { name: "New", auditId: "x" }));
        await assertFails(deleteDoc(doc(db, name, "legacy-doc")));
      }
    await assertFails(getDoc(doc(dbFor("recorder"), "identities", users.recorder.uid)));
  });

  it("does not let a verified email grant itself a role or write its own role document", async () => {
    const db = dbFor("adminA");
    await assertFails(setDoc(doc(db, "platformRoles", "a-admin@example.com"), { role: "organizer", auditId: "self" }));
    await assertFails(grantOrganizer("adminA", "a-admin@example.com"));
    await assertFails(grantConferenceAdmin("adminA", B, "a-admin@example.com"));
    await assertFails(setDoc(doc(dbFor("recorder"), "conferences", A, "admins", "recorder@example.com"), { email: "recorder@example.com", auditId: "self" }));
  });
});
