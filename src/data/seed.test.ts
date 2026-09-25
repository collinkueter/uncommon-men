import { describe, expect, it } from "vitest";
import { initialCategories, initialEvents } from "@/domain/catalog";
import { createSeedState } from "./seed";

describe("demo seed fixture", () => {
  it("covers the complete catalog and coherent entity references", () => {
    const state = createSeedState();
    expect(state.categories).toHaveLength(6);
    expect(state.events).toHaveLength(initialEvents.length);
    expect(state.categories.map((category) => category.id)).toEqual(
      initialCategories.map((category) => category.id),
    );
    expect(state.events.map((event) => event.id)).toEqual(
      initialEvents.map((event) => event.id),
    );
    expect(state.events.map((event) => event.id)).toEqual([
      "dumbbell-hold-15-lb",
      "dumbbell-hold-20-lb",
      "push-up",
      "single-arm-bicep-curl-20-lb",
      "plank-holds",
      "cornhole",
      "basketball-free-throws",
      "lightning-knockout",
      "pound-the-nail",
      "grid-based-logic-puzzle",
      "sudoku",
      "chess",
      "checkers",
      "table-tennis",
      "carpet-ball",
      "foosball",
    ]);
    const participantIds = new Set(
      state.participants.map((participant) => participant.id),
    );
    const teamIds = new Set(state.teams.map((team) => team.id));
    state.teams.forEach((team) => {
      expect(team.memberIds).toHaveLength(2);
      team.memberIds.forEach((memberId) =>
        expect(participantIds.has(memberId)).toBe(true),
      );
    });
    state.brackets.forEach((bracket) => {
      const event = state.events.find((item) => item.id === bracket.eventId)!;
      const allowed = event.team ? teamIds : participantIds;
      bracket.entrants.forEach((entrantId) =>
        expect(allowed.has(entrantId)).toBe(true),
      );
    });
  });

  it("contains representative leaderboard data and live cornhole semifinal fixture", () => {
    const state = createSeedState();
    const dumbbellHold = state.attempts
      .filter((attempt) => attempt.eventId === "dumbbell-hold-15-lb" && attempt.valid)
      .sort((a, b) => b.value - a.value);
    expect(
      state.participants.find(
        (participant) => participant.id === dumbbellHold[0].participantId,
      )?.name,
    ).toBe("Caleb Johnson");
    expect(dumbbellHold[0].value).toBe(62.4);
    const heavierDumbbellHold = state.attempts
      .filter((attempt) => attempt.eventId === "dumbbell-hold-20-lb" && attempt.valid)
      .sort((a, b) => b.value - a.value);
    expect(heavierDumbbellHold[0].value).toBe(44.8);
    const cornhole = state.brackets.find(
      (bracket) => bracket.eventId === "cornhole",
    )!;
    expect(cornhole.status).toBe("active");
    const teams = new Map(state.teams.map((team) => [team.id, team.name]));
    const final = cornhole.matches.find((match) => match.round === 2)!;
    expect([teams.get(final.sideA!), teams.get(final.sideB!)]).toEqual([
      "Iron Brothers",
      "The Anchors",
    ]);
    expect(final.winnerId).toBeNull();
    expect(state.audit).toEqual([]);
    expect(new Date(state.attempts[0].createdAt).getUTCFullYear()).toBe(2026);
  });
});
