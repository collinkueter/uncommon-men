import { describe, expect, it } from "vitest";
import { conferencePath, DEFAULT_CONFERENCE_ID, legacyRedirectPath, relativeConferencePath } from "./conferencePaths";

describe("conference paths", () => {
  it("prefixes conference-relative paths with /c/<slug>", () => {
    expect(conferencePath("uncommon-men-2026", "/events")).toBe("/c/uncommon-men-2026/events");
    expect(conferencePath("uncommon-men-2026", "/events/push-up")).toBe("/c/uncommon-men-2026/events/push-up");
    expect(conferencePath("spring", "/welcome?next=%2Fevents")).toBe("/c/spring/welcome?next=%2Fevents");
    expect(conferencePath("spring", "/")).toBe("/c/spring");
    expect(conferencePath("spring", "admin")).toBe("/c/spring/admin");
  });

  it("recovers the conference-relative part of a pathname", () => {
    expect(relativeConferencePath("/c/spring/events/push-up")).toBe("/events/push-up");
    expect(relativeConferencePath("/c/spring")).toBe("/");
    expect(relativeConferencePath("/c/spring/")).toBe("/");
    expect(relativeConferencePath("/events")).toBe("/events");
  });
});

describe("legacy redirects", () => {
  it.each([
    ["/", "", `/c/${DEFAULT_CONFERENCE_ID}`],
    ["/events", "", `/c/${DEFAULT_CONFERENCE_ID}/events`],
    ["/events/push-up", "", `/c/${DEFAULT_CONFERENCE_ID}/events/push-up`],
    ["/events/push-up/", "", `/c/${DEFAULT_CONFERENCE_ID}/events/push-up`],
    ["/standings", "?demo=1", `/c/${DEFAULT_CONFERENCE_ID}/standings?demo=1`],
    ["/results", "", `/c/${DEFAULT_CONFERENCE_ID}/results`],
    ["/admin", "?demo=1", `/c/${DEFAULT_CONFERENCE_ID}/admin?demo=1`],
    ["/welcome", "?next=%2Fevents&demo=1", `/c/${DEFAULT_CONFERENCE_ID}/welcome?next=%2Fevents&demo=1`],
    ["/nowhere", "", `/c/${DEFAULT_CONFERENCE_ID}/nowhere`],
  ])("moves %s%s under the default conference", (pathname, search, expected) => {
    expect(legacyRedirectPath(pathname, search, DEFAULT_CONFERENCE_ID)).toBe(expected);
  });

  it("uses the configured default conference", () => {
    expect(legacyRedirectPath("/events/push-up", "?demo=1", "fall-2027")).toBe("/c/fall-2027/events/push-up?demo=1");
  });
});
