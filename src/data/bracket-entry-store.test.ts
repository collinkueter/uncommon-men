import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "./seed";
import { createBracket } from "@/domain/ranking";
import { createConferenceStore } from "./store";

beforeEach(() => {
  const data = createSeedState();
  const teams = data.teams.filter((team) => team.eventId === "cornhole");
  data.brackets = [createBracket("cornhole", teams.slice(0, 2).map((team) => team.id))];
  const storage = new Map([
    ["uncommon-men.demo-state.v1", JSON.stringify(data)],
    ["uncommon-men.demo-identity", JSON.stringify({ name: "Test admin" })],
  ]);
  vi.stubGlobal("window", { location: { search: "?demo=1" } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("add team command", () => {
  it("adds and audits once, rejects stale retries, and locks after play", async () => {
    const store = createConferenceStore();
    const original = store.getSnapshot().data.brackets[0];
    const teams = store.getSnapshot().data.teams.filter((team) => team.eventId === "cornhole");
    const command = { type: "addBracketTeam" as const, bracketId: original.id, teamId: teams[2].id, revision: original.revision };
    await store.execute(command);
    expect(store.getSnapshot().data.brackets[0].entrants).toHaveLength(3);
    expect(store.getSnapshot().data.audit[0]).toMatchObject({ action: "addBracketTeam", before: original });
    await expect(store.execute(command)).rejects.toThrow(/changed/);
    const beforePlay = store.getSnapshot().data.brackets[0];
    const match = beforePlay.matches.find((item) => item.sideA && item.sideB && !item.bye)!;
    await store.execute({ type: "matchWinner", bracketId: beforePlay.id, matchId: match.id, winnerId: match.sideA!, revision: beforePlay.revision });
    const afterPlay = store.getSnapshot().data.brackets[0];
    await expect(store.execute({ ...command, teamId: teams[3].id, revision: afterPlay.revision })).rejects.toThrow(/result/);
    expect(store.getSnapshot().data.brackets[0]).toEqual(afterPlay);
  });

  it("rejects nonadmins and teams from another event", async () => {
    const store = createConferenceStore();
    const bracket = store.getSnapshot().data.brackets[0];
    const other = store.getSnapshot().data.teams.find((team) => team.eventId !== "cornhole")!;
    const command = { type: "addBracketTeam" as const, bracketId: bracket.id, teamId: other.id, revision: bracket.revision };
    await expect(store.execute(command)).rejects.toThrow(/registered team/);
    await store.signOutAdmin();
    await expect(store.execute(command)).rejects.toThrow(/Administrator/);
    expect(store.getSnapshot().data.brackets[0]).toEqual(bracket);
  });
});
