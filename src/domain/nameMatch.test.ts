import { describe, expect, it } from "vitest";
import { findSimilarParticipants, nameSimilarity } from "./nameMatch";
import type { Participant } from "./types";

const person = (name: string): Participant => ({ id: name, name, normalizedName: name.toLowerCase() });

describe("name similarity", () => {
  it.each([
    ["Roger Smith", "Roger"],
    ["roger", "Roger Smith"],
    ["Roger S", "Roger Smith"],
    ["Rodger Smith", "Roger Smith"],
    ["Rodger", "Roger"],
    ["Michael Smith", "Mike"],
    ["Bob Jones", "Robert Jones"],
    ["R Smith", "Roger Smith"],
    ["José Diaz", "Jose Diaz"],
  ])("treats %s and %s as possibly the same person", (typed, existing) => {
    expect(nameSimilarity(typed, existing)).toBeGreaterThan(0);
  });

  it.each([
    ["Roger Smith", "Bob Smith"],
    ["Roger Smith", "Roger Jones"],
    ["Ben", "Ken"],
    ["Al", "Ed"],
    ["Caleb Johnson", "Marcus Reed"],
  ])("does not pair %s with %s", (typed, existing) => {
    expect(nameSimilarity(typed, existing)).toBe(0);
  });

  it("ranks the closest names first", () => {
    const roster = [person("Rodney Smith"), person("Roger"), person("Roger Smith"), person("Bob Smith")];
    expect(findSimilarParticipants("Roger Smith", roster).map((p) => p.name)).toEqual(["Roger Smith", "Roger"]);
  });
});
