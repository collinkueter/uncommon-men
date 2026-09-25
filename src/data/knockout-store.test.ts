import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "./seed";
import { createConferenceStore } from "./store";

const eventId = "lightning-knockout";

beforeEach(() => {
  const data = createSeedState();
  data.events = data.events.map((event) => event.id === eventId ? { ...event, kind: "knockout" } : event);
  data.games = data.games.filter((game) => game.eventId !== eventId);
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

describe("knockout games", () => {
  it("registers named participants, starts administratively, and records one winner", async () => {
    const store = await createConferenceStore();
    await store.signOutAdmin();
    const [first, second] = store.getSnapshot().data.participants;
    await store.execute({ type: "joinGame", eventId, participantId: first.id });
    await store.execute({ type: "joinGame", eventId, participantId: second.id });
    await expect(store.execute({ type: "startGame", eventId })).rejects.toThrow(/Administrator/);
    await store.signInAdmin();
    await store.execute({ type: "startGame", eventId });
    const active = store.getSnapshot().data.games.find((game) => game.eventId === eventId)!;
    expect(active).toMatchObject({ status: "active", entrants: [first.id, second.id], revision: 3 });
    await store.signOutAdmin();
    await store.execute({ type: "gameWinner", eventId, winnerId: first.id, revision: active.revision });
    expect(store.getSnapshot().data.games.find((game) => game.eventId === eventId)).toMatchObject({ status: "complete", winnerId: first.id, revision: 4 });
    await expect(store.execute({ type: "gameWinner", eventId, winnerId: second.id, revision: 4 })).rejects.toThrow(/Administrator/);
    store.dispose();
  });

  it("rejects numeric scoring for knockout events", async () => {
    const store = await createConferenceStore();
    const participant = store.getSnapshot().data.participants[0];
    await expect(store.execute({ type: "attempt", eventId, name: participant.name, participantId: participant.id, value: 1, requestId: "numeric-knockout" })).rejects.toThrow(/winners/);
    store.dispose();
  });

  it("rejects unknown entrants and stale or unjustified winner corrections", async () => {
    const store = await createConferenceStore();
    await store.signOutAdmin();
    const [first, second] = store.getSnapshot().data.participants;
    await expect(store.execute({ type: "joinGame", eventId, participantId: "missing" })).rejects.toThrow(/invalid/);
    await store.execute({ type: "joinGame", eventId, participantId: first.id });
    await store.execute({ type: "joinGame", eventId, participantId: second.id });
    await store.signInAdmin();
    await store.execute({ type: "startGame", eventId });
    const active = store.getSnapshot().data.games.find((game) => game.eventId === eventId)!;
    await store.signOutAdmin();
    await store.execute({ type: "gameWinner", eventId, winnerId: first.id, revision: active.revision });
    const complete = store.getSnapshot().data.games.find((game) => game.eventId === eventId)!;
    await store.signInAdmin();
    await expect(store.execute({ type: "gameWinner", eventId, winnerId: second.id, revision: active.revision, reason: "stale correction" })).rejects.toThrow(/changed/);
    await store.signOutAdmin();
    await expect(store.execute({ type: "gameWinner", eventId, winnerId: second.id, revision: complete.revision })).rejects.toThrow(/Administrator/);
    await store.signInAdmin();
    await expect(store.execute({ type: "gameWinner", eventId, winnerId: second.id, revision: complete.revision })).rejects.toThrow(/reason/);
    await store.execute({ type: "gameWinner", eventId, winnerId: second.id, revision: complete.revision, reason: "Verified correction" });
    expect(store.getSnapshot().data.games.find((game) => game.eventId === eventId)?.winnerId).toBe(second.id);
    store.dispose();
  });
});
