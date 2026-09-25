import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "./seed";
import { createConferenceStore } from "./store";

const eventId = "carpet-ball";
beforeEach(() => {
  const data = createSeedState();
  data.brackets = data.brackets.filter((bracket) => bracket.eventId !== eventId);
  const storage = new Map([
    ["uncommon-men.demo-state.v1", JSON.stringify(data)],
    ["uncommon-men.demo-identity", JSON.stringify({ name: "Test user" })],
  ]);
  vi.stubGlobal("window", { location: { search: "?demo=1" } });
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe("bracket starts", () => {
  it("requires admin and preserves all registered entrants", async () => {
    const store = await createConferenceStore();
    const [first, second, third] = store.getSnapshot().data.participants;
    await store.signOutAdmin();
    for (const entrant of [first, second, third]) await store.execute({ type: "joinBracket", eventId, entrantId: entrant.id });
    await expect(store.execute({ type: "startBracket", eventId, entrantIds: [first.id, second.id] })).rejects.toThrow(/Administrator/);
    await store.signInAdmin();
    await store.execute({ type: "startBracket", eventId, entrantIds: [first.id, second.id] });
    const bracket = store.getSnapshot().data.brackets.find((item) => item.eventId === eventId)!;
    expect(bracket.status).toBe("active");
    expect(bracket.entrants).toEqual([first.id, second.id, third.id]);
    expect(bracket.revision).toBe(4);
    expect(store.getSnapshot().data.audit[0]).toMatchObject({ action: "startBracket", before: expect.objectContaining({ status: "registration" }) });
  });

  it("supports legacy admin starts without registration", async () => {
    const store = await createConferenceStore();
    const participants = store.getSnapshot().data.participants.slice(0, 2);
    await store.execute({ type: "startBracket", eventId, entrantIds: participants.map((item) => item.id) });
    expect(store.getSnapshot().data.brackets.find((item) => item.eventId === eventId)?.entrants).toEqual(participants.map((item) => item.id));
  });

  it("rejects invalid joins and premature starts", async () => {
    const store = await createConferenceStore();
    const participant = store.getSnapshot().data.participants[0];
    await store.signOutAdmin();
    await expect(store.execute({ type: "joinBracket", eventId: "push-up", entrantId: participant.id })).rejects.toThrow(/not found or inactive/);
    await store.execute({ type: "joinBracket", eventId, entrantId: participant.id });
    await store.signInAdmin();
    await expect(store.execute({ type: "startBracket", eventId, entrantIds: ["stale"] })).rejects.toThrow(/two or more/);
  });
});
