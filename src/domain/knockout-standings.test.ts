import { describe, expect, it } from "vitest";
import { initialEvents } from "./catalog";
import { categoryStandings, createBracket, eventStandings, advanceBracket, overallStandings } from "./ranking";
import type { ConferenceState, Participant } from "./types";

const participants: Participant[] = ["a", "b", "c"].map((id) => ({
  id,
  name: id.toUpperCase(),
  normalizedName: id,
}));

const state = (games: ConferenceState["games"] = []): ConferenceState => ({
  categories: [],
  events: initialEvents,
  participants,
  teams: [],
  attempts: [],
  brackets: [],
  games,
  audit: [],
});

describe("knockout standings", () => {
  it("does not show standings before the game is complete", () => {
    expect(
      eventStandings(state([
        {
          id: "lightning-knockout-game",
          eventId: "lightning-knockout",
          entrants: ["a", "b"],
          status: "active",
          winnerId: null,
          revision: 1,
        },
      ]), "lightning-knockout"),
    ).toEqual([]);
  });

  it("awards the winner ten points and includes every registered participant", () => {
    const standings = eventStandings(
      state([
        {
          id: "lightning-knockout-game",
          eventId: "lightning-knockout",
          entrants: ["a", "b", "c"],
          status: "complete",
          winnerId: "b",
          revision: 2,
        },
      ]),
      "lightning-knockout",
    );
    expect(standings).toEqual([
      { id: "b", name: "B", rank: 1, points: 10, value: 1, eventsPlayed: 1 },
      { id: "a", name: "A", rank: 0, points: 0, value: 0, eventsPlayed: 1 },
      { id: "c", name: "C", rank: 0, points: 0, value: 0, eventsPlayed: 1 },
    ]);
  });

  it("does not derive knockout standings from attempts or brackets", () => {
    const current = state([]);
    current.attempts.push({
      id: "attempt",
      eventId: "lightning-knockout",
      participantId: "a",
      value: 99,
      valid: true,
      recordedBy: "r",
      recorderName: "R",
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    });
    expect(eventStandings(current, "lightning-knockout")).toEqual([]);
  });

  it("awards knockout points through category and overall totals", () => {
    const current = state([
      {
        id: "lightning-knockout-game",
        eventId: "lightning-knockout",
        entrants: ["a", "b", "c"],
        status: "complete",
        winnerId: "b",
        revision: 2,
      },
    ]);
    expect(eventStandings(current, "lightning-knockout").map((item) => item.points)).toEqual([10, 0, 0]);
    expect(categoryStandings(current, "precision-accuracy").find((item) => item.id === "b")).toMatchObject({ points: 10 });
    expect(overallStandings(current).find((item) => item.id === "b")).toMatchObject({ points: 10 });
  });

  it("leaves bracket scoring unchanged", () => {
    let bracket = createBracket("chess", ["a", "b"]);
    const match = bracket.matches[0];
    bracket = advanceBracket(bracket, match.id, "a");
    expect(eventStandings({ ...state(), brackets: [bracket] }, "chess")[0]).toMatchObject({ id: "a", points: 10 });
  });
});
