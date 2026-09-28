import { describe, expect, it } from "vitest";
import type { Competition } from "./types";
import { conferenceSignUrl, eventSignUrl, scoringSummary } from "./signs";

const base = (overrides: Partial<Competition> = {}): Competition => ({
  id: "push-up",
  categoryId: "brute-strength",
  name: "Push Up",
  kind: "count",
  direction: "higher",
  unit: "reps",
  team: false,
  teamSize: 1,
  instructions: "",
  active: true,
  ...overrides,
});

describe("eventSignUrl", () => {
  it("builds a legacy URL without a conference slug", () => {
    expect(eventSignUrl("https://uncommon-men.web.app", null, "push-up")).toBe(
      "https://uncommon-men.web.app/events/push-up",
    );
  });

  it("builds a /c/:slug URL with a conference slug", () => {
    expect(
      eventSignUrl("https://uncommon-men.web.app", "uncommon-men-2026", "push-up"),
    ).toBe("https://uncommon-men.web.app/c/uncommon-men-2026/events/push-up");
  });

  it("strips a trailing slash from the origin", () => {
    expect(eventSignUrl("https://uncommon-men.web.app/", null, "push-up")).toBe(
      "https://uncommon-men.web.app/events/push-up",
    );
  });
});

describe("conferenceSignUrl", () => {
  it("builds the legacy events list URL without a slug", () => {
    expect(conferenceSignUrl("https://uncommon-men.web.app", undefined)).toBe(
      "https://uncommon-men.web.app/events",
    );
  });

  it("builds a /c/:slug events list URL with a slug", () => {
    expect(
      conferenceSignUrl("https://uncommon-men.web.app", "uncommon-men-2026"),
    ).toBe("https://uncommon-men.web.app/c/uncommon-men-2026/events");
  });
});

describe("scoringSummary", () => {
  it("describes a higher-wins count event", () => {
    expect(scoringSummary(base())).toBe("Most reps wins");
  });

  it("describes a lower-wins count event", () => {
    expect(scoringSummary(base({ direction: "lower", unit: "seconds" }))).toBe(
      "Fewest seconds wins",
    );
  });

  it("describes a higher-wins duration event", () => {
    expect(scoringSummary(base({ kind: "duration", unit: "seconds" }))).toBe(
      "Longest time wins",
    );
  });

  it("describes a lower-wins duration event", () => {
    expect(
      scoringSummary(base({ kind: "duration", direction: "lower", unit: "seconds" })),
    ).toBe("Fastest time wins");
  });

  it("describes a higher-wins distance event", () => {
    expect(scoringSummary(base({ kind: "distance", unit: "feet" }))).toBe(
      "Farthest distance wins",
    );
  });

  it("describes a lower-wins distance event", () => {
    expect(
      scoringSummary(base({ kind: "distance", direction: "lower", unit: "feet" })),
    ).toBe("Shortest distance wins");
  });

  it("describes an individual bracket event", () => {
    expect(scoringSummary(base({ kind: "bracket", unit: "match" }))).toBe(
      "Bracket — single elimination",
    );
  });

  it("describes a team bracket event", () => {
    expect(
      scoringSummary(base({ kind: "bracket", unit: "match", team: true, teamSize: 2 })),
    ).toBe("Team bracket — single elimination");
  });

  it("describes a knockout event", () => {
    expect(scoringSummary(base({ kind: "knockout", unit: "winner" }))).toBe(
      "Knockout — last player standing",
    );
  });

  it("prefixes team for a non-bracket team event", () => {
    expect(scoringSummary(base({ team: true, teamSize: 2 }))).toBe(
      "Team most reps wins",
    );
  });
});
