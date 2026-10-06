import { describe, expect, it } from "vitest";
import { createSeedState } from "@/data/seed";
import { initialCategories, initialEvents } from "./catalog";
import {
  copyCatalog,
  detailsError,
  directorySections,
  emailError,
  eventAlreadyPresent,
  filterConferences,
  formatDateRange,
  latestConference,
  normalizeEmail,
  removesLastOrganizer,
  PAIRS_PER_CHUNK,
  parseEmailList,
  planCatalogImport,
  planConferenceCreation,
  resolveServerTime,
  SERVER_TIME,
  slugError,
  statusAction,
  suggestSlug,
  type NewConferenceInput,
} from "./conferences";
import type { Conference } from "./types";

describe("slugs", () => {
  it("suggests a slug from the conference name", () => {
    expect(suggestSlug("Uncommon Men 2027")).toBe("uncommon-men-2027");
    expect(suggestSlug("  Fall Retreat -- Café & Grill! ")).toBe("fall-retreat-cafe-and-grill");
    expect(suggestSlug("Élan / Été 2027")).toBe("elan-ete-2027");
    expect(suggestSlug("!!!")).toBe("");
    const long = suggestSlug(`${"word ".repeat(30)}end`);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).not.toMatch(/-$/);
    expect(slugError(long)).toBeNull();
  });

  it("validates format, length and uniqueness", () => {
    expect(slugError("fall-2027")).toBeNull();
    expect(slugError("")).toMatch(/Enter/);
    expect(slugError("a")).toMatch(/at least 2/);
    expect(slugError("a".repeat(61))).toMatch(/60 characters/);
    expect(slugError("a".repeat(60))).toBeNull();
    for (const bad of ["Fall-2027", "fall_2027", "-fall", "fall-", "fall--2027", "fall 2027", "fall/2027"])
      expect(slugError(bad), bad).toMatch(/lowercase/);
    expect(slugError("fall-2027", ["spring-2027", "fall-2027"])).toMatch(/already uses/);
  });
});

describe("role emails", () => {
  it("trims and lowercases emails used as role document ids", () => {
    expect(normalizeEmail("  Randy.Drish@Example.COM ")).toBe("randy.drish@example.com");
    expect(emailError(" Randy@Example.com ")).toBeNull();
    expect(emailError("")).toMatch(/Enter/);
    for (const bad of ["randy", "randy@", "@example.com", "ran dy@example.com", "randy@example", "a/b@example.com"])
      expect(emailError(bad), bad).not.toBeNull();
  });

  it("parses a list of admin emails, deduplicating and reporting bad ones", () => {
    expect(parseEmailList("A@example.com, b@example.com;\na@EXAMPLE.com  nope")).toEqual({
      emails: ["a@example.com", "b@example.com"],
      errors: ["nope is not a valid email address."],
    });
    expect(parseEmailList("  ")).toEqual({ emails: [], errors: [] });
  });
});

describe("conference details and status", () => {
  const details = { name: "Fall", startDate: "2027-10-01", endDate: "2027-10-03", location: "Hall" };
  it("validates details against the rules' limits", () => {
    expect(detailsError(details)).toBeNull();
    expect(detailsError({ ...details, name: " " })).toMatch(/name/);
    expect(detailsError({ ...details, name: "x".repeat(101) })).toMatch(/100/);
    expect(detailsError({ ...details, endDate: "2027-09-30" })).toMatch(/before/);
    expect(detailsError({ ...details, startDate: "" })).toMatch(/date/);
    expect(detailsError({ ...details, location: "x".repeat(121) })).toMatch(/120/);
  });

  it("moves draft to live to archived and back to live", () => {
    expect(statusAction("draft")).toEqual({ to: "live", label: "Publish" });
    expect(statusAction("live")).toEqual({ to: "archived", label: "Archive" });
    expect(statusAction("archived")).toEqual({ to: "live", label: "Unarchive" });
  });

  it("formats date ranges", () => {
    expect(formatDateRange("2027-10-01", "2027-10-03")).toBe("Oct 1 – 3, 2027");
    expect(formatDateRange("2027-09-30", "2027-10-02")).toBe("Sep 30 – Oct 2, 2027");
    expect(formatDateRange("2027-12-30", "2028-01-02")).toBe("Dec 30, 2027 – Jan 2, 2028");
    expect(formatDateRange("2027-10-01", "2027-10-01")).toBe("Oct 1, 2027");
    expect(formatDateRange("", "")).toBe("");
  });
});

describe("directory", () => {
  const conference = (id: string, status: Conference["status"], startDate: string, endDate = startDate, extra: Partial<Conference> = {}): Conference => ({
    id, slug: id, name: id, startDate, endDate, location: "", status, ...extra,
  });
  const all = [
    conference("past-2024", "archived", "2024-09-01"),
    conference("draft-2028", "draft", "2028-01-01"),
    conference("fall-2027", "live", "2027-10-01"),
    conference("past-2025", "archived", "2025-09-01"),
    conference("spring-2027", "live", "2027-04-01"),
  ];

  it("orders live conferences by start date, then past ones most recent first", () => {
    const sections = directorySections(all, false);
    expect(sections.current.map((item) => item.id)).toEqual(["spring-2027", "fall-2027"]);
    expect(sections.past.map((item) => item.id)).toEqual(["past-2025", "past-2024"]);
    expect(sections.drafts).toEqual([]);
  });

  it("lists drafts only for viewers who can read them", () => {
    expect(directorySections(all, true).drafts.map((item) => item.id)).toEqual(["draft-2028"]);
  });

  it("filters by name, address and location, ignoring case and accents", () => {
    const list = [
      conference("men-2027", "live", "2027-01-01", "2027-01-01", { name: "Uncommon Men 2027", location: "Zürich" }),
      conference("retreat", "live", "2027-01-01", "2027-01-01", { name: "Leaders Retreat", location: "Austin" }),
    ];
    expect(filterConferences(list, "").length).toBe(2);
    expect(filterConferences(list, "zurich").map((item) => item.id)).toEqual(["men-2027"]);
    expect(filterConferences(list, "LEADERS austin").map((item) => item.id)).toEqual(["retreat"]);
    expect(filterConferences(list, "men-2027").map((item) => item.id)).toEqual(["men-2027"]);
    expect(directorySections(list, false, "nothing").current).toEqual([]);
  });
});

describe("conference creation plan", () => {
  const actor = { uid: "u1", email: "Randy@Example.com", name: "Randy Drish" };
  let counter = 0;
  const newId = () => `audit-${++counter}`;
  const input = (overrides: Partial<NewConferenceInput> = {}): NewConferenceInput => ({
    name: " Fall 2027 ",
    slug: "fall-2027",
    startDate: "2027-10-01",
    endDate: "2027-10-03",
    location: "Hall",
    status: "draft",
    ...copyCatalog({ categories: initialCategories, events: initialEvents }),
    adminEmails: [" Helper@Example.com", "helper@example.com"],
    sourceLabel: "built-in catalog",
    ...overrides,
  });

  it("pairs every document with an audit entry that matches it exactly", () => {
    const plan = planConferenceCreation(input(), actor, newId);
    const pairs = plan.chunks.flat();
    expect(pairs.length).toBe(2 + 1 + initialCategories.length + initialEvents.length);
    for (const { target, audit } of pairs) {
      expect(audit.path.slice(0, 3)).toEqual(["conferences", "fall-2027", "audit"]);
      expect(audit.path[3]).toBe(target.data.auditId);
      expect(audit.data.after).toEqual(target.data);
      expect(audit.data.before).toBeNull();
      expect(audit.data.actorUid).toBe("u1");
      expect(audit.data.at).toBe(SERVER_TIME);
      expect(Object.keys(audit.data).sort()).toEqual(
        ["action", "actorName", "actorUid", "after", "at", "before", "entityId", "entityType", "reason"],
      );
      expect(target.path.at(-1)).toBe(audit.data.entityId);
    }
    const ids = pairs.map(({ audit }) => audit.path[3]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("creates a draft conference first, the creator's identity, then admins and the catalog", () => {
    const plan = planConferenceCreation(input({ status: "live" }), actor, newId);
    const [first, ...rest] = plan.chunks;
    expect(first.map(({ target }) => target.path.join("/"))).toEqual([
      "conferences/fall-2027",
      "conferences/fall-2027/identities/u1",
    ]);
    const conference = first[0];
    expect(conference.target.data).toMatchObject({
      name: "Fall 2027", slug: "fall-2027", status: "draft", location: "Hall", createdAt: SERVER_TIME,
    });
    expect(conference.audit.data).toMatchObject({ entityType: "conference", entityId: "fall-2027", actorName: "Randy@Example.com" });
    expect(first[1].target.data).toMatchObject({ uid: "u1", name: "Randy Drish", participantId: null });
    expect(first[1].audit.data).toMatchObject({ entityType: "identities", actorName: "Randy Drish" });
    expect(plan.publish).toBe(true);
    const flat = rest.flat();
    expect(flat[0].target.path).toEqual(["conferences", "fall-2027", "admins", "helper@example.com"]);
    expect(flat[0].target.data).toMatchObject({ email: "helper@example.com" });
    expect(flat[0].audit.data).toMatchObject({ entityType: "admins", action: "grantAdmin", actorName: "Randy@Example.com" });
    expect(flat.filter(({ target }) => target.path[2] === "admins")).toHaveLength(1);
    for (const { target, audit } of flat.filter(({ target }) => ["categories", "events"].includes(target.path[2]))) {
      expect(audit.data.actorName).toBe("Randy Drish");
      expect(target.data).not.toHaveProperty("id");
    }
  });

  it("keeps chunks within the rules' lookup budget without splitting pairs", () => {
    const plan = planConferenceCreation(input(), actor, newId);
    for (const chunk of plan.chunks) expect(chunk.length).toBeLessThanOrEqual(PAIRS_PER_CHUNK);
    expect(plan.chunks.length).toBe(1 + Math.ceil((1 + initialCategories.length + initialEvents.length) / PAIRS_PER_CHUNK));
    expect(planConferenceCreation(input({ status: "draft" }), actor, newId).publish).toBe(false);
  });

  it("copies only the catalog from another conference, never participants or results", () => {
    const source = createSeedState();
    expect(source.participants.length).toBeGreaterThan(0);
    expect(source.attempts.length).toBeGreaterThan(0);
    const copied = copyCatalog({
      ...source,
      events: source.events.map((event) => ({ ...event, auditId: "x", extra: 1 }) as typeof event),
    });
    expect(Object.keys(copied)).toEqual(["categories", "events"]);
    expect(copied.events[0]).not.toHaveProperty("auditId");
    expect(copied.events[0]).not.toHaveProperty("extra");
    const plan = planConferenceCreation(
      input({ ...copied, events: copied.events.filter((event) => event.id === "push-up"), adminEmails: [] }),
      actor,
      newId,
    );
    const collections = new Set(plan.chunks.flat().map(({ target }) => target.path[2] ?? "conference"));
    expect([...collections].sort()).toEqual(["categories", "conference", "events", "identities"]);
    const events = plan.chunks.flat().filter(({ target }) => target.path[2] === "events");
    expect(events).toHaveLength(1);
    const pushUp = initialEvents.find((event) => event.id === "push-up")!;
    const { id: _id, ...fields } = pushUp;
    expect(events[0].target.data).toEqual({ ...fields, auditId: events[0].target.data.auditId });
  });

  it("skips the identity when no catalog is copied and rejects invalid input", () => {
    const plan = planConferenceCreation(input({ categories: [], events: [], adminEmails: [] }), actor, newId);
    expect(plan.chunks.flat().map(({ target }) => target.path.length)).toEqual([2]);
    expect(() => planConferenceCreation(input({ slug: "Bad Slug" }), actor, newId)).toThrow(/lowercase/);
    expect(() => planConferenceCreation(input({ endDate: "2027-01-01" }), actor, newId)).toThrow(/before/);
    expect(() => planConferenceCreation(input({ adminEmails: ["nope"] }), actor, newId)).toThrow(/valid email/);
    expect(() => planConferenceCreation(input(), { ...actor, email: "" }, newId)).toThrow(/Google/);
  });

  it("resolves the server-time marker anywhere in a document", () => {
    expect(resolveServerTime({ a: SERVER_TIME, b: { c: SERVER_TIME, d: [1] }, e: null }, 5)).toEqual({
      a: 5, b: { c: 5, d: [1] }, e: null,
    });
  });
});

describe("removesLastOrganizer", () => {
  it("is true only when the email is the sole listed organizer", () => {
    expect(removesLastOrganizer(["randy@example.com"], " Randy@Example.com ")).toBe(true);
    expect(removesLastOrganizer(["randy@example.com", "collin@example.com"], "randy@example.com")).toBe(false);
    expect(removesLastOrganizer(["randy@example.com"], "someone@example.com")).toBe(false);
    expect(removesLastOrganizer([], "randy@example.com")).toBe(false);
  });
});

describe("latestConference", () => {
  const conf = (id: string, startDate: string, createdAt?: number) =>
    ({ id, slug: id, name: id, startDate, endDate: startDate, location: "", status: "live", createdAt }) as const;
  it("picks the latest start date, then the newest", () => {
    expect(latestConference([conf("a", "2025-10-01"), conf("b", "2026-10-01"), conf("c", "")])?.id).toBe("b");
    expect(latestConference([conf("a", "", 1), conf("b", "", 5)])?.id).toBe("b");
    expect(latestConference([])).toBeUndefined();
  });
});

describe("planCatalogImport", () => {
  const source = copyCatalog({ categories: initialCategories, events: initialEvents });
  it("skips events already present by id or name and adds only missing categories", () => {
    const [kept, renamed, fresh] = source.events;
    const target = {
      categories: source.categories.filter((c) => c.id !== fresh.categoryId),
      events: [kept, { ...renamed, id: "other-id" }],
    };
    expect(eventAlreadyPresent(kept, target)).toBe(true);
    expect(eventAlreadyPresent(renamed, target)).toBe(true);
    const plan = planCatalogImport(source, target, [kept.id, renamed.id, fresh.id]);
    expect(plan.events.map((e) => e.id)).toEqual([fresh.id]);
    const needsCategory = !target.categories.some((c) => c.id === fresh.categoryId);
    expect(plan.categories.map((c) => c.id)).toEqual(needsCategory ? [fresh.categoryId] : []);
  });
  it("reuses a target category with the same name", () => {
    const event = source.events[0];
    const category = source.categories.find((c) => c.id === event.categoryId)!;
    const target = { categories: [{ ...category, id: "local" }], events: [] };
    const plan = planCatalogImport(source, target, [event.id]);
    expect(plan.categories).toEqual([]);
    expect(plan.events[0].categoryId).toBe("local");
  });
});
