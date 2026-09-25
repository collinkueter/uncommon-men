import { describe, expect, it } from "vitest";
import { initialEvents } from "./catalog";
import {
  advanceBracket,
  categoryStandings,
  createBracket,
  eventStandings,
  formatScore,
  getBestAttempt,
  normalizeName,
  overallStandings,
} from "./ranking";
import type { ConferenceState, Participant } from "./types";

const participants: Participant[] = ["a", "b", "c", "d", "e"].map((id) => ({
  id,
  name: id.toUpperCase(),
  normalizedName: id,
}));
const state = (overrides: Partial<ConferenceState> = {}): ConferenceState => ({
  categories: [],
  events: initialEvents,
  participants,
  teams: [],
  attempts: [],
  brackets: [],
  games: [],
  audit: [],
  ...overrides,
});

describe("scoring", () => {
  it("normalizes names and selects the best valid attempt by direction", () => {
    expect(normalizeName("  José   VAN   Dijk ")).toBe("jose van dijk");
    const current = state({
      attempts: [
        {
          id: "1",
          eventId: "push-up",
          participantId: "a",
          value: 3,
          valid: true,
          recordedBy: "r",
          recorderName: "R",
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
        {
          id: "2",
          eventId: "push-up",
          participantId: "a",
          value: 8,
          valid: false,
          recordedBy: "r",
          recorderName: "R",
          createdAt: 2,
          updatedAt: 2,
          revision: 1,
        },
        {
          id: "3",
          eventId: "push-up",
          participantId: "a",
          value: 5,
          valid: false,
          recordedBy: "r",
          recorderName: "R",
          createdAt: 3,
          updatedAt: 3,
          revision: 1,
        },
      ],
    });
    expect(getBestAttempt(current, "push-up", "a")?.value).toBe(3);
  });

  it("shares ties and averages occupied placement points, including zero", () => {
    const attempts = ["a", "b", "c"].map((participantId, i) => ({
      id: String(i),
      eventId: "push-up",
      participantId,
      value: i < 2 ? 5 : 3,
      valid: true,
      recordedBy: "r",
      recorderName: "R",
      createdAt: i,
      updatedAt: i,
      revision: 1,
    }));
    const standings = eventStandings(state({ attempts }), "push-up");
    expect(standings.map((item) => [item.rank, item.points])).toEqual([
      [1, 9],
      [1, 9],
      [3, 6],
    ]);
  });

  it("aggregates categories and excludes teams from the overall standings", () => {
    const attempts = participants
      .slice(0, 2)
      .map((p, i) => ({
        id: String(i),
        eventId: "push-up",
        participantId: p.id,
        value: i + 1,
        valid: true,
        recordedBy: "r",
        recorderName: "R",
        createdAt: i,
        updatedAt: i,
        revision: 1,
      }));
    expect(
      categoryStandings(state({ attempts }), "brute-strength")[0].points,
    ).toBe(10);
    expect(overallStandings(state({ attempts })).map((x) => x.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("formats durations as minutes, seconds and hundredths", () => {
    expect(
      formatScore(
        65.2,
        initialEvents.find((e) => e.id === "pound-the-nail")!,
      ),
    ).toBe("01:05.20");
    expect(
      formatScore(
        59.999,
        initialEvents.find((e) => e.id === "pound-the-nail")!,
      ),
    ).toBe("01:00.00");
  });

  it("keeps lower scores positive and totals placement points across events", () => {
    const attempts = [
      ...participants
        .slice(0, 2)
        .map((p, i) => ({
          id: `p${i}`,
          eventId: "dumbbell-hold-15-lb",
          participantId: p.id,
          value: 10 - i,
          valid: true,
          recordedBy: "r",
          recorderName: "R",
          createdAt: i,
          updatedAt: i,
          revision: 1,
        })),
      ...participants
        .slice(0, 2)
        .map((p, i) => ({
          id: `q${i}`,
          eventId: "push-up",
          participantId: p.id,
          value: 20 - i,
          valid: true,
          recordedBy: "r",
          recorderName: "R",
          createdAt: i,
          updatedAt: i,
          revision: 1,
        })),
    ];
    const current = state({ attempts });
    expect(
      eventStandings(
        state({
          attempts: [
            {
              id: "t",
              eventId: "pound-the-nail",
              participantId: "a",
              value: 12.5,
              valid: true,
              recordedBy: "r",
              recorderName: "R",
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
          ],
        }),
        "pound-the-nail",
      )[0].value,
    ).toBe(12.5);
    expect(categoryStandings(current, "brute-strength")[0]).toMatchObject({
      id: "a",
      points: 20,
      value: 20,
    });
  });

  it("ranks zero scores after a leader and averages their occupied points", () => {
    const attempts = [10, 0, 0].map((value, i) => ({
      id: String(i),
      eventId: "push-up",
      participantId: participants[i].id,
      value,
      valid: true,
      recordedBy: "r",
      recorderName: "R",
      createdAt: i,
      updatedAt: i,
      revision: 1,
    }));
    expect(
      eventStandings(state({ attempts }), "push-up").map((item) => [
        item.rank,
        item.points,
      ]),
    ).toEqual([
      [1, 10],
      [2, 7],
      [2, 7],
    ]);
  });

  it("combines categories in overall standings while retaining actual lower scores", () => {
    const attempts = [
      {
        id: "p1",
        eventId: "push-up",
        participantId: "a",
        value: 10,
        valid: true,
        recordedBy: "r",
        recorderName: "R",
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      },
      {
        id: "p2",
        eventId: "push-up",
        participantId: "b",
        value: 5,
        valid: true,
        recordedBy: "r",
        recorderName: "R",
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      },
      {
        id: "t1",
        eventId: "pound-the-nail",
        participantId: "a",
        value: 20,
        valid: true,
        recordedBy: "r",
        recorderName: "R",
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      },
      {
        id: "t2",
        eventId: "pound-the-nail",
        participantId: "b",
        value: 30,
        valid: true,
        recordedBy: "r",
        recorderName: "R",
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      },
    ];
    expect(
      categoryStandings(state({ attempts }), "brute-strength")[0],
    ).toMatchObject({ id: "a", points: 10 });
    expect(
      overallStandings(state({ attempts })).map((item) => [
        item.id,
        item.points,
      ]),
    ).toEqual([
      ["a", 20],
      ["b", 16],
    ]);
    expect(
      eventStandings(state({ attempts }), "pound-the-nail").map((item) => item.value),
    ).toEqual([20, 30]);
  });
});

describe("brackets", () => {
  it("creates and resolves a three entrant bracket with a bye", () => {
    const bracket = createBracket("table-tennis", ["a", "b", "c"]);
    expect(bracket.matches.filter((m) => m.bye)).toHaveLength(1);
    const first = bracket.matches.find((m) => m.round === 1 && !m.bye)!;
    const next = advanceBracket(bracket, first.id, first.sideA!);
    const final = next.matches.find((m) => m.round === 2)!;
    expect(final.sideA).toBeTruthy();
    expect(final.sideB).toBeTruthy();
    const complete = advanceBracket(next, final.id, final.sideA!);
    expect(complete.status).toBe("complete");
    expect(
      eventStandings(state({ brackets: [complete] }), "table-tennis")[0].points,
    ).toBe(10);
  });

  it("invalidates a completed final when a semifinal competitor changes", () => {
    let bracket = createBracket("table-tennis", ["a", "b", "c", "d"]);
    const semis = bracket.matches.filter((m) => m.round === 1);
    bracket = advanceBracket(bracket, semis[0].id, "a");
    bracket = advanceBracket(bracket, semis[1].id, "c");
    const final = bracket.matches.find((m) => m.round === 2)!;
    bracket = advanceBracket(bracket, final.id, "c");
    expect(bracket.status).toBe("complete");
    bracket = advanceBracket(bracket, semis[0].id, "b");
    expect(bracket.status).toBe("active");
    expect(bracket.matches.find((m) => m.id === final.id)?.winnerId).toBeNull();
  });

  it("assigns shared elimination ranks and averaged points in an eight entrant bracket", () => {
    let bracket = createBracket("table-tennis", [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
    for (let round = 1; round <= 3; round += 1) {
      for (const match of bracket.matches.filter(
        (item) =>
          item.round === round && item.sideA && item.sideB && !item.winnerId,
      ))
        bracket = advanceBracket(bracket, match.id, match.sideA!);
    }
    const standings = eventStandings(state({ brackets: [bracket] }), "table-tennis");
    expect(standings.map((item) => [item.rank, item.points])).toEqual([
      [1, 10],
      [2, 8],
      [3, 5.5],
      [3, 5.5],
      [5, 2.5],
      [5, 2.5],
      [5, 2.5],
      [5, 2.5],
    ]);
  });

  it("uses team names for completed team brackets and excludes team points from categories and overall", () => {
    let bracket = createBracket("cornhole", [
      "team-a",
      "team-b",
      "team-c",
      "team-d",
    ]);
    for (const match of bracket.matches.filter((item) => item.round === 1))
      bracket = advanceBracket(bracket, match.id, match.sideA!);
    const final = bracket.matches.find((item) => item.round === 2)!;
    bracket = advanceBracket(bracket, final.id, final.sideA!);
    const teams = ["team-a", "team-b", "team-c", "team-d"].map((id) => ({
      id,
      eventId: "cornhole",
      name: id.toUpperCase(),
      memberIds: [],
    }));
    const current = state({ teams, brackets: [bracket] });
    expect(eventStandings(current, "cornhole")[0].name).toBe("TEAM-A");
    expect(categoryStandings(current, "precision-accuracy")).toEqual([]);
    expect(overallStandings(current)).toEqual([]);
  });

  it("leaves brackets active while a feeder match is unresolved", () => {
    for (const entrants of [
      ["a", "b"],
      ["a", "b", "c"],
      ["a", "b", "c", "d", "e"],
      ["a", "b", "c", "d", "e", "a2", "b2", "c2"],
    ]) {
      const bracket = createBracket("table-tennis", entrants);
      expect(bracket.status).toBe("active");
      expect(
        bracket.matches.find(
          (m) => m.round === Math.max(...bracket.matches.map((x) => x.round)),
        )?.winnerId,
      ).toBeNull();
    }
  });

  it("handles five entrants, rejects duplicates and clears corrected descendants", () => {
    const bracket = createBracket("table-tennis", ["a", "b", "c", "d", "e"]);
    expect(bracket.matches.filter((m) => m.bye)).toHaveLength(3);
    expect(
      bracket.matches.filter((m) => m.round === 1 && !m.sideA && !m.sideB),
    ).toHaveLength(0);
    const pending = bracket.matches.find(
      (m) => m.round === Math.max(...bracket.matches.map((x) => x.round)),
    )!;
    expect(() => advanceBracket(bracket, pending.id, "a")).toThrow();
    expect(() => createBracket("table-tennis", ["a", "a"])).toThrow();
    const first = bracket.matches.find((m) => m.round === 1 && !m.bye)!;
    const winner = first.sideA!;
    const changed = advanceBracket(bracket, first.id, winner);
    const later = changed.matches.find(
      (m) => m.round === 2 && m.position === Math.floor(first.position / 2),
    )!;
    expect(later.sideA).toBeTruthy();
    expect(later.sideB).toBeTruthy();
    const advanced = advanceBracket(changed, later.id, later.sideA!);
    const corrected = advanceBracket(advanced, first.id, first.sideB!);
    expect(
      corrected.matches.find((m) => m.id === later.id)?.winnerId,
    ).toBeNull();
  });

  it("rejects a winner who is not in the match", () => {
    const bracket = createBracket("table-tennis", ["a", "b"]);
    expect(() => advanceBracket(bracket, bracket.matches[0].id, "z")).toThrow();
  });
});
