import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "./seed";
import { createConferenceStore } from "./store";

const eventId = "carpet-ball";
const teamEventId = "cornhole";

beforeEach(() => {
  const data = createSeedState();
  data.brackets = data.brackets.filter((bracket) => bracket.eventId !== eventId && bracket.eventId !== teamEventId);
  const storage = new Map([
    ["uncommon-men.demo-state.v1", JSON.stringify(data)],
    ["uncommon-men.demo-identity", JSON.stringify({ name: "Public player" })],
  ]);
  vi.stubGlobal("window", { location: { search: "?demo=1" } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("bracket registration", () => {
  it("creates a registration bracket and makes repeated joins idempotent", async () => {
    const store = await createConferenceStore();
    await store.signOutAdmin();
    const participant = store.getSnapshot().data.participants[0];
    const join = { type: "joinBracket" as const, eventId, entrantId: participant.id };
    await store.execute(join);
    const first = store.getSnapshot().data.brackets.find((bracket) => bracket.eventId === eventId)!;
    expect(first).toMatchObject({
      id: `${eventId}-bracket`, status: "registration", entrants: [participant.id],
      matches: [], entrantsOpen: true, revision: 1,
    });
    await store.execute(join);
    expect(store.getSnapshot().data.brackets.find((bracket) => bracket.eventId === eventId)).toEqual(first);
  });

  it("starts from all registered entrants and rejects premature public starts", async () => {
    const store = await createConferenceStore();
    await store.signOutAdmin();
    const [first, second] = store.getSnapshot().data.participants;
    await store.execute({ type: "joinBracket", eventId, entrantId: first.id });
    await expect(store.execute({ type: "startBracket", eventId, entrantIds: [first.id, second.id] }))
      .rejects.toThrow(/Administrator/);
    await store.execute({ type: "joinBracket", eventId, entrantId: second.id });
    await store.signInAdmin();
    await store.execute({ type: "startBracket", eventId, entrantIds: ["stale"] });
    expect(store.getSnapshot().data.brackets.find((bracket) => bracket.eventId === eventId)).toMatchObject({
      status: "active", entrants: [first.id, second.id], revision: 3,
    });
  });

  it("auto-registers public team creation, then gates late teams", async () => {
    const store = await createConferenceStore();
    await store.signOutAdmin();
    const members = store.getSnapshot().data.participants.slice(0, 2).map((item) => item.id);
    await store.execute({ type: "saveTeam", eventId: teamEventId, name: "Public Team", memberIds: members });
    const registration = store.getSnapshot().data.brackets.find((item) => item.eventId === teamEventId)!;
    const team = store.getSnapshot().data.teams.find((item) => item.name === "Public Team")!;
    expect(registration).toMatchObject({ status: "registration", entrants: [team.id], matches: [], revision: 1 });
    expect(store.getSnapshot().data.audit.filter((entry) => entry.action === "joinBracket")).toHaveLength(1);
    await store.execute({ type: "saveTeam", eventId: teamEventId, name: "Second Team", memberIds: members });
    await store.signInAdmin();
    await store.execute({ type: "startBracket", eventId: teamEventId, entrantIds: ["stale"] });
    await store.signOutAdmin();
    await expect(store.execute({ type: "saveTeam", eventId: teamEventId, name: "Late Public Team", memberIds: members })).rejects.toThrow(/Administrator/);
    await store.signInAdmin();
    await store.execute({ type: "saveTeam", eventId: teamEventId, name: "Admin Late Team", memberIds: members });
    const active = store.getSnapshot().data.brackets.find((item) => item.eventId === teamEventId)!;
    expect(active.status).toBe("active");
    expect(active.entrants).toHaveLength(2);
  });
});
