import { afterEach, describe, expect, it, vi } from "vitest";
import { initialEvents } from "@/domain/catalog";
import { createSeedState, DEMO_RECORDED_AT } from "./seed";
import { createConferenceStore, migrateLegacyDemoDates, validateTeamInput } from "./store";

const legacyRecordedAt = 1_726_000_000_000;

describe("demo state migration", () => {
  it("replaces the persisted demo catalog while preserving current activity data", () => {
    const state = createSeedState();
    state.events.push({ ...initialEvents[0], id: "parkour", name: "Legacy Parkour" });
    state.attempts.push({
      ...state.attempts[0],
      id: "user-added-parkour-attempt",
      eventId: "parkour",
    });
    const userAdded = {
      ...state.attempts[0],
      id: "user-added-attempt",
      eventId: "push-up",
    };
    state.attempts.push(userAdded);

    const migrated = migrateLegacyDemoDates(state);

    expect(migrated.events.some((event) => event.id === "parkour")).toBe(false);
    expect(migrated.attempts.some((attempt) => attempt.eventId === "parkour")).toBe(false);
    expect(migrated.events).toEqual(initialEvents);
    expect(migrated.categories).toHaveLength(6);
    expect(migrated.attempts).toContainEqual(userAdded);
  });

  it("shifts recognizable fixture dates while preserving cached user edits", () => {
    const state = createSeedState();
    const fixture = state.attempts.find((attempt) => attempt.id === "demo-attempt-dumbbell-hold-15-lb-demo-p1-1")!;
    fixture.createdAt = legacyRecordedAt + 60;
    fixture.updatedAt = Date.parse("2026-09-22T14:00:00Z");
    fixture.value = 77;
    fixture.valid = false;
    const userAdded = {
      ...fixture,
      id: "user-added-attempt",
      participantId: "new-person",
      createdAt: legacyRecordedAt,
      updatedAt: fixture.updatedAt,
    };
    state.attempts.push(userAdded);
    state.audit.push({
      id: "demo-audit-dumbbell-hold-15-lb-correction",
      action: "correctAttempt",
      entityType: "attempt",
      entityId: fixture.id,
      actorUid: "demo-operator",
      actorName: "Demo operator",
      at: legacyRecordedAt + 60,
      before: { value: 126.12 },
      after: { value: 77, valid: false },
      reason: "Cached user edit",
    });

    const migrated = migrateLegacyDemoDates(state);
    const shift = DEMO_RECORDED_AT - legacyRecordedAt;
    const migratedFixture = migrated.attempts.find((attempt) => attempt.id === fixture.id)!;
    expect(migratedFixture.createdAt).toBe(legacyRecordedAt + 60 + shift);
    expect(migratedFixture.updatedAt).toBe(fixture.updatedAt);
    expect(migratedFixture.value).toBe(77);
    expect(migratedFixture.valid).toBe(false);
    expect(migrated.attempts.find((attempt) => attempt.id === userAdded.id)?.createdAt).toBe(
      legacyRecordedAt,
    );
    expect(migrated.audit.at(-1)?.at).toBe(legacyRecordedAt + 60 + shift);
    expect(migrateLegacyDemoDates(migrated)).toEqual(migrated);
  });
});

describe("team save validation", () => {
  it("trims names, removes duplicate members, and accepts a valid roster", () => {
    const state = createSeedState();
    const result = validateTeamInput(state, {
      type: "saveTeam",
      eventId: "cornhole",
      name: "  New Crew  ",
      memberIds: ["demo-p1", "demo-p2", "demo-p1"],
    });

    expect(result.name).toBe("New Crew");
    expect(result.memberIds).toEqual(["demo-p1", "demo-p2"]);
  });

  it.each([
    ["non-team event", { eventId: "push-up", name: "Crew", memberIds: ["demo-p1"] }],
    ["overlong name", { eventId: "cornhole", name: "x".repeat(81), memberIds: ["demo-p1", "demo-p2"] }],
    ["unknown participant", { eventId: "cornhole", name: "Crew", memberIds: ["demo-p1", "missing"] }],
    ["wrong team size", { eventId: "cornhole", name: "Crew", memberIds: ["demo-p1"] }],
  ])("rejects %s", (_label, command) => {
    expect(() => validateTeamInput(createSeedState(), { type: "saveTeam", ...command })).toThrow(
      "Enter a valid team name and members.",
    );
  });
});

describe("demo identity registration", () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = (identity?: { name: string; participantId?: string }) => {
    const data = createSeedState();
    const storage = new Map<string, string>([["uncommon-men.demo-state.v1", JSON.stringify(data)]]);
    if (identity) storage.set("uncommon-men.demo-identity", JSON.stringify(identity));
    vi.stubGlobal("window", { location: { search: "?demo=1" } });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    return storage;
  };

  it.each([undefined, "demo-p1"] as const)("renames the linked record while retaining its results and teams (%s)", async (participantId) => {
    setup({ name: "Caleb Johnson", participantId: "demo-p1" });
    const store = await createConferenceStore();
    const before = store.getSnapshot();
    const participantCount = before.data.participants.length;
    const attempts = before.data.attempts;
    const teams = before.data.teams;

    await store.execute({
      type: "identity",
      name: "Caleb J",
      ...(participantId ? { participantId } : {}),
    });

    const after = store.getSnapshot();
    expect(after.identity).toMatchObject({ name: "Caleb J", participantId: "demo-p1" });
    expect(after.data.participants).toHaveLength(participantCount);
    expect(after.data.participants.find((participant) => participant.id === "demo-p1"))
      .toMatchObject({ name: "Caleb J", normalizedName: "caleb j" });
    expect(after.data.attempts).toEqual(attempts);
    expect(after.data.teams).toEqual(teams);
    expect(after.data.audit[0]).toMatchObject({ action: "identity" });
    expect(after.data.audit[1]).toMatchObject({ action: "renameParticipant", entityId: "demo-p1" });
    store.dispose();
  });

  it("links an explicitly selected different participant without renaming it", async () => {
    setup({ name: "Caleb Johnson", participantId: "demo-p1" });
    const store = await createConferenceStore();
    const selected = store.getSnapshot().data.participants.find((participant) => participant.id === "demo-p2")!;

    await store.execute({ type: "identity", name: "Edited label", participantId: selected.id });

    expect(store.getSnapshot().identity).toMatchObject({ name: selected.name, participantId: selected.id });
    expect(store.getSnapshot().data.participants.find((participant) => participant.id === selected.id)).toEqual(selected);
    store.dispose();
    vi.unstubAllGlobals();
  });

  it("creates and links a participant for first registration", async () => {
    setup();
    const store = await createConferenceStore();

    await store.execute({ type: "identity", name: "First Registration" });

    const identity = store.getSnapshot().identity!;
    expect(identity.name).toBe("First Registration");
    expect(store.getSnapshot().data.participants).toContainEqual({
      id: identity.participantId,
      name: "First Registration",
      normalizedName: "first registration",
    });
    store.dispose();
  });
});
