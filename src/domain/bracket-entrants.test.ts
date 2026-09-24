import { describe, expect, it } from "vitest";
import { addBracketEntrant, advanceBracket, canAddBracketEntrants, createBracket } from "./ranking";

describe("adding bracket entrants before play", () => {
  it("rebuilds across bracket sizes without losing entrants and increments revisions", () => {
    const original = createBracket("cornhole", ["a", "b"]);
    const three = addBracketEntrant(original, "c");
    const four = addBracketEntrant(three, "d");
    const five = addBracketEntrant(four, "e");
    expect(three.matches.some((match) => match.bye && match.winnerId)).toBe(true);
    expect(four.matches.filter((match) => match.bye)).toHaveLength(0);
    expect(five.entrants).toEqual(["a", "b", "c", "d", "e"]);
    expect(five.matches).toHaveLength(7);
    expect(five.revision).toBe(original.revision + 3);
    expect(original.entrants).toEqual(["a", "b"]);
    expect(canAddBracketEntrants(five)).toBe(true);
  });

  it("locks immediately after any played match, including a first-round match", () => {
    const bracket = createBracket("cornhole", ["a", "b", "c"]);
    const match = bracket.matches.find((item) => !item.bye && item.sideA && item.sideB)!;
    const played = advanceBracket(bracket, match.id, match.sideA!);
    expect(canAddBracketEntrants(played)).toBe(false);
    expect(() => addBracketEntrant(played, "d")).toThrow(/result/);
    expect(() => addBracketEntrant({ ...played, entrantsOpen: true }, "d")).toThrow(/result/);
  });

  it("rejects duplicates and excess entrants", () => {
    expect(() => addBracketEntrant(createBracket("cornhole", ["a", "b"]), "a")).toThrow(/already/);
    expect(() => addBracketEntrant(createBracket("cornhole", Array.from({ length: 128 }, (_, i) => String(i))), "extra")).toThrow(/128/);
  });

  it("supports untouched legacy brackets without reopening previously revised ones", () => {
    const { entrantsOpen: _, ...legacy } = createBracket("cornhole", ["a", "b", "c"]);
    expect(canAddBracketEntrants(legacy)).toBe(true);
    expect(canAddBracketEntrants({ ...legacy, revision: 2 })).toBe(false);
    expect(canAddBracketEntrants({ ...legacy, entrantsOpen: false })).toBe(false);
  });
});
