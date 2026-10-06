import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where, type Firestore } from "firebase/firestore";
import { initialCategories, initialEvents } from "@/domain/catalog";
import { copyCatalog, planConferenceCreation, type NewConferenceInput } from "@/domain/conferences";
import {
  commitConferenceCreation,
  newAuditId,
  readCatalog,
  setConferenceAdminRole,
  setDefaultConference,
  setOrganizerRole,
  updateConference,
} from "@/data/platformWrites";
import { seedConference } from "./conference";

// The organizer and conference-admin flows exactly as the app commits them
// (src/data/platformWrites.ts), against the deployed rules.
let environment: RulesTestEnvironment;
const A = "conf-a";

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "uncommon-men-organizer-test",
    firestore: { host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(async () => environment.cleanup());

const users = {
  // Legacy custom-claim organizer signed in with Google.
  claim: { uid: "claim-organizer", token: { admin: true, email: "owner@example.com", email_verified: true }, name: "Owner" },
  // platformRoles organizer: verified Google email, no claim.
  randy: { uid: "randy", token: { email: "Randy@Example.com", email_verified: true }, name: "Randy Drish" },
  adminA: { uid: "admin-a", token: { email: "a-admin@example.com", email_verified: true }, name: "Admin A" },
  unverified: { uid: "unverified", token: { email: "randy@example.com", email_verified: false }, name: "Imposter" },
  recorder: { uid: "recorder", token: {}, name: "Recorder" },
} as const;
type User = keyof typeof users;
const dbFor = (user: User) => environment.authenticatedContext(users[user].uid, users[user].token).firestore() as unknown as Firestore;
const actor = (user: User) => ({
  uid: users[user].uid,
  email: "email" in users[user].token ? (users[user].token as { email: string }).email : "",
  name: users[user].name,
});

function creationInput(slug: string, overrides: Partial<NewConferenceInput> = {}): NewConferenceInput {
  return {
    name: `Conference ${slug}`,
    slug,
    startDate: "2027-10-01",
    endDate: "2027-10-03",
    location: "Test hall",
    status: "live",
    ...copyCatalog({ categories: initialCategories, events: initialEvents }),
    adminEmails: ["Helper@Example.com", "second@example.com"],
    sourceLabel: "built-in catalog",
    ...overrides,
  };
}

async function create(user: User, slug: string, overrides: Partial<NewConferenceInput> = {}) {
  // A recorder has no email; claim one so the rules, not the client check, decide.
  const who = { ...actor(user), email: actor(user).email || "anonymous@example.com" };
  const plan = planConferenceCreation(creationInput(slug, overrides), who, newAuditId);
  return commitConferenceCreation(dbFor(user), who, plan);
}

async function read(path: string) {
  let data: Record<string, unknown> | undefined;
  await environment.withSecurityRulesDisabled(async (context) => {
    data = (await getDoc(doc(context.firestore(), path))).data();
  });
  return data;
}

async function count(path: string) {
  let size = 0;
  await environment.withSecurityRulesDisabled(async (context) => {
    size = (await getDocs(collection(context.firestore(), path))).size;
  });
  return size;
}

beforeEach(async () => {
  await environment.clearFirestore();
  await seedConference(environment, A);
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "platformRoles", "randy@example.com"), { role: "organizer", auditId: "seed-organizer" }),
      setDoc(doc(db, "conferences", A, "admins", "a-admin@example.com"), { email: "a-admin@example.com", auditId: "seed-admin-a" }),
      setDoc(doc(db, "conferences", A, "participants", "p1"), { name: "Marcus Reed", normalizedName: "marcus reed", auditId: "seed-p1" }),
    ]);
  });
});

describe("creating conferences", () => {
  it("lets a platformRoles organizer (verified email, no claim) create a live conference with events and admins", async () => {
    await assertSucceeds(create("randy", "fall-2027"));
    expect(await read("conferences/fall-2027")).toMatchObject({ status: "live", slug: "fall-2027", name: "Conference fall-2027" });
    expect(await count("conferences/fall-2027/categories")).toBe(initialCategories.length);
    expect(await count("conferences/fall-2027/events")).toBe(initialEvents.length);
    expect(await read("conferences/fall-2027/admins/helper@example.com")).toMatchObject({ email: "helper@example.com" });
    expect(await read("conferences/fall-2027/admins/second@example.com")).toBeDefined();
    expect(await read("conferences/fall-2027/identities/randy")).toMatchObject({ name: "Randy Drish", participantId: null });
    // Conference + identity + 2 admins + catalog, plus the publish entry.
    expect(await count("conferences/fall-2027/audit")).toBe(4 + initialCategories.length + initialEvents.length + 1);
  });

  it("lets a claim organizer create a draft conference", async () => {
    await assertSucceeds(create("claim", "spring-2028", { status: "draft", adminEmails: [] }));
    expect(await read("conferences/spring-2028")).toMatchObject({ status: "draft" });
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "conferences", "spring-2028")));
  });

  it("copies another conference's catalog, never its participants", async () => {
    await create("randy", "source-2026", { adminEmails: [] });
    const catalog = await assertSucceeds(readCatalog(dbFor("randy"), "source-2026"));
    await assertSucceeds(create("randy", "copy-2027", { ...catalog, events: catalog.events.slice(0, 3), adminEmails: [] }));
    expect(await count("conferences/copy-2027/events")).toBe(3);
    expect(await count("conferences/copy-2027/participants")).toBe(0);
  });

  it("refuses conference creation to conference admins, recorders and unverified emails", async () => {
    await assertFails(create("adminA", "admin-made"));
    await assertFails(create("adminA", "admin-made-empty", { categories: [], events: [], adminEmails: [] }));
    await assertFails(create("unverified", "imposter"));
    await assertFails(create("recorder", "recorder-made"));
    expect(await read("conferences/admin-made")).toBeUndefined();
    expect(await read("conferences/imposter")).toBeUndefined();
  });

  it("does not overwrite an existing conference", async () => {
    await expect(create("randy", A)).rejects.toThrow(/already uses/);
  });
});

describe("organizer actions", () => {
  it("lets a platformRoles organizer do every organizer action", async () => {
    const db = dbFor("randy");
    const me = actor("randy");
    await assertSucceeds(create("randy", "fall-2027", { status: "draft", adminEmails: [] }));
    await assertSucceeds(getDocs(collection(db, "conferences")));
    await assertSucceeds(updateConference(db, me, "fall-2027", { status: "live" }, "setConferenceStatus"));
    await assertSucceeds(updateConference(db, me, "fall-2027", { name: "Fall 2027", location: "New hall" }));
    await assertSucceeds(setDefaultConference(db, me, "fall-2027"));
    expect(await read("settings/platform")).toMatchObject({ defaultConferenceId: "fall-2027" });
    await assertSucceeds(setOrganizerRole(db, me, " Collin@Example.com ", true));
    expect(await read("platformRoles/collin@example.com")).toMatchObject({ role: "organizer" });
    await assertSucceeds(setOrganizerRole(db, me, "collin@example.com", false));
    expect(await read("platformRoles/collin@example.com")).toBeUndefined();
    await assertSucceeds(setConferenceAdminRole(db, me, "fall-2027", "Helper@Example.com", true));
    await assertSucceeds(setConferenceAdminRole(db, me, "fall-2027", "helper@example.com", false));
    expect(await read("conferences/fall-2027/admins/helper@example.com")).toBeUndefined();
    await assertSucceeds(updateConference(db, me, "fall-2027", { status: "archived" }, "setConferenceStatus"));
    await assertFails(setConferenceAdminRole(db, me, "fall-2027", "late@example.com", true));
    await assertSucceeds(updateConference(db, me, "fall-2027", { status: "live" }, "setConferenceStatus"));
    await assertSucceeds(getDocs(collection(db, "platformAudit")));
  });

  it("refuses to remove the last listed organizer", async () => {
    const db = dbFor("randy");
    const me = actor("randy");
    await expect(setOrganizerRole(db, me, "randy@example.com", false)).rejects.toThrow(/last organizer/);
    expect(await read("platformRoles/randy@example.com")).toMatchObject({ role: "organizer" });
    await assertSucceeds(setOrganizerRole(db, me, "collin@example.com", true));
    await assertSucceeds(setOrganizerRole(db, me, "randy@example.com", false));
    expect(await read("platformRoles/randy@example.com")).toBeUndefined();
  });

  it("refuses organizer actions to a conference admin, who may only edit their conference's details", async () => {
    const db = dbFor("adminA");
    const me = actor("adminA");
    await assertFails(setOrganizerRole(db, me, "friend@example.com", true));
    await assertFails(setConferenceAdminRole(db, me, A, "friend@example.com", true));
    await assertFails(setDefaultConference(db, me, A));
    await assertFails(updateConference(db, me, A, { status: "archived" }, "setConferenceStatus"));
    await assertSucceeds(updateConference(db, me, A, { name: "Renamed", startDate: "2026-10-02", endDate: "2026-10-04" }));
    expect(await read(`conferences/${A}`)).toMatchObject({ name: "Renamed", status: "live" });
    await create("randy", "other-2027", { adminEmails: [] });
    await assertFails(updateConference(db, me, "other-2027", { name: "Not mine" }));
    await assertFails(getDocs(collection(db, "conferences")));
  });

  it("lets a granted conference admin manage only that conference", async () => {
    await create("randy", "fall-2027", { adminEmails: ["a-admin@example.com"] });
    const db = dbFor("adminA");
    await assertSucceeds(updateConference(db, actor("adminA"), "fall-2027", { location: "Moved" }));
    await assertSucceeds(getDocs(collection(db, "conferences", "fall-2027", "audit")));
    await assertFails(setConferenceAdminRole(db, actor("adminA"), "fall-2027", "friend@example.com", true));
  });
});

describe("directory queries", () => {
  it("lets anyone list live and archived conferences but only organizers list drafts", async () => {
    await seedConference(environment, "old-2025", "archived");
    await seedConference(environment, "hidden-2028", "draft");
    const publicQuery = (db: Firestore) =>
      getDocs(query(collection(db, "conferences"), where("status", "in", ["live", "archived"])));
    const anonymous = environment.unauthenticatedContext().firestore() as unknown as Firestore;
    const listed = await assertSucceeds(publicQuery(anonymous));
    expect(listed.docs.map((item) => item.id).sort()).toEqual([A, "old-2025"]);
    await assertSucceeds(publicQuery(dbFor("recorder")));
    await assertFails(getDocs(collection(anonymous, "conferences")));
    await assertFails(getDocs(collection(dbFor("recorder"), "conferences")));
    const all = await assertSucceeds(getDocs(collection(dbFor("randy"), "conferences")));
    expect(all.size).toBe(3);
    await assertSucceeds(getDocs(collection(dbFor("claim"), "conferences")));
    await assertSucceeds(getDocs(collection(dbFor("randy"), "platformRoles")));
    await assertFails(getDocs(collection(dbFor("adminA"), "platformRoles")));
  });
});
