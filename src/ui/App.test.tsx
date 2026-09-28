import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "@/data/seed";
import type { AppSnapshot, Conference, PlatformSnapshot } from "@/domain/types";
import { AppRoutes } from "./App";

const context = vi.hoisted(() => ({ snapshot: {} as AppSnapshot, platform: {} as PlatformSnapshot }));
vi.mock("@/lib/PlatformContext", () => ({
  usePlatform: () => ({ snapshot: context.platform, store: {} }),
}));
vi.mock("@/lib/ConferenceContext", () => ({
  ConferenceProvider: ({ children }: { children: ReactNode }) => children,
  useConference: () => ({
    ...context.snapshot,
    snapshot: context.snapshot,
    execute: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInAdmin: vi.fn(),
    signOutAdmin: vi.fn(),
    clearError: vi.fn(),
  }),
}));
vi.mock("@/lib/defaultConference", () => ({
  peekDefaultConferenceId: () => "uncommon-men-2026",
  loadDefaultConferenceId: async () => "uncommon-men-2026",
}));
// Static rendering runs no effects, so a redirect is rendered as a marker.
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  Navigate: ({ to }: { to: string }) => <meta data-navigate={to} />,
}));
(globalThis as { __APP_COMMIT__?: string }).__APP_COMMIT__ = "test";

function render(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
const redirect = (html: string) => /data-navigate="([^"]*)"/.exec(html)?.[1];

const location = { search: "" };
vi.stubGlobal("window", {
  location,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});

const conference = (id: string, status: Conference["status"], startDate: string): Conference => ({
  id, slug: id, name: `Conf ${id}`, startDate, endDate: startDate, location: "Hall", status,
});

beforeEach(() => {
  location.search = "";
  context.platform = {
    mode: "firebase",
    identity: null,
    identityLoading: false,
    conferences: [
      conference("old-2025", "archived", "2025-09-01"),
      conference("hidden-2028", "draft", "2028-01-01"),
      conference("fall-2027", "live", "2027-10-01"),
      conference("spring-2027", "live", "2027-04-01"),
    ],
    conferencesLoading: false,
    defaultConferenceId: "spring-2027",
    organizers: [],
    audit: [],
    error: null,
  };
  context.snapshot = {
    conferenceId: "spring-retreat",
    conference: { id: "spring-retreat", slug: "spring-retreat", name: "Spring Retreat", startDate: "2027-04-01", endDate: "2027-04-03", location: "", status: "live" },
    conferenceState: "ready",
    data: createSeedState(),
    identity: { uid: "u", name: "Caleb Johnson", participantId: "demo-p1", admin: true, organizer: false },
    loading: false,
    identityLoading: false,
    error: null,
    mode: "firebase",
    connected: true,
  };
});

describe("legacy redirects", () => {
  it.each([
    ["/events", "/c/uncommon-men-2026/events"],
    ["/events/push-up", "/c/uncommon-men-2026/events/push-up"],
    ["/standings?demo=1", "/c/uncommon-men-2026/standings?demo=1"],
    ["/results", "/c/uncommon-men-2026/results"],
    ["/admin?demo=1", "/c/uncommon-men-2026/admin?demo=1"],
    ["/welcome?next=%2Fevents", "/c/uncommon-men-2026/welcome?next=%2Fevents"],
    ["/somewhere-else", "/c/uncommon-men-2026/somewhere-else"],
  ])("redirects %s to %s", (from, to) => {
    expect(redirect(render(from))).toBe(to);
  });

  it("sends the bare conference path to events or the name screen", () => {
    expect(redirect(render("/c/spring-retreat"))).toBe("/c/spring-retreat/events");
    context.snapshot.identity = { ...context.snapshot.identity!, name: "" };
    expect(redirect(render("/c/spring-retreat"))).toBe("/c/spring-retreat/welcome");
  });

  it("sends unknown conference pages to that conference's events", () => {
    expect(redirect(render("/c/spring-retreat/nope"))).toBe("/c/spring-retreat/events");
  });
});

describe("conference-prefixed links", () => {
  it.each(["/c/spring-retreat/events", "/c/spring-retreat/results", "/c/spring-retreat/welcome"])(
    "keeps every internal link on %s inside the conference",
    (path) => {
      const links = hrefs(render(path));
      expect(links.length).toBeGreaterThan(3);
      for (const link of links) expect(link).toMatch(/^\/c\/spring-retreat(\/|$)/);
      expect(links).toContain("/c/spring-retreat/standings");
      expect(links).toContain("/c/spring-retreat/admin");
    },
  );

  it("keeps ?demo=1 on conference links", () => {
    location.search = "?demo=1";
    const links = hrefs(render("/c/spring-retreat/events?demo=1"));
    expect(links).toContain("/c/spring-retreat/standings?demo=1");
    expect(links).toContain("/c/spring-retreat/events/push-up?demo=1");
  });

  it("links event rows to the conference's event page", () => {
    expect(hrefs(render("/c/spring-retreat/events"))).toContain("/c/spring-retreat/events/push-up");
  });

  it("returns the profile link to the conference-relative page", () => {
    expect(hrefs(render("/c/spring-retreat/standings?x=1"))).toContain(
      "/c/spring-retreat/welcome?next=%2Fstandings",
    );
  });

  it("shows a not-found page for a missing or hidden conference", () => {
    context.snapshot = { ...context.snapshot, conference: null, conferenceState: "missing" };
    const html = render("/c/spring-retreat/events");
    expect(html).toContain("Conference not found");
    expect(html).not.toContain("push-up");
  });

  it("disables entry forms in an archived conference", () => {
    context.snapshot.conference = { ...context.snapshot.conference!, status: "archived" };
    const html = render("/c/spring-retreat/welcome");
    expect(html).toContain("is archived");
    expect(html).toMatch(/<fieldset class="archive-lock" disabled="">/);
  });
});

describe("conference directory", () => {
  it("lists live conferences first (soonest first), then past ones, without redirecting", () => {
    const html = render("/");
    expect(redirect(html)).toBeUndefined();
    const links = hrefs(html);
    expect(links.indexOf("/c/spring-2027")).toBeLessThan(links.indexOf("/c/fall-2027"));
    expect(links.indexOf("/c/fall-2027")).toBeLessThan(links.indexOf("/c/old-2025"));
    expect(html).toContain("Past conferences");
    expect(links).not.toContain("/c/hidden-2028");
    expect(html).not.toContain("Find your conference");
  });

  it("does not auto-redirect when exactly one conference is live", () => {
    context.platform.conferences = [conference("fall-2027", "live", "2027-10-01")];
    const html = render("/");
    expect(redirect(html)).toBeUndefined();
    expect(hrefs(html)).toContain("/c/fall-2027");
  });

  it("shows drafts and the organizer link to organizers, keeping ?demo=1", () => {
    location.search = "?demo=1";
    context.platform.identity = { uid: "o", email: "o@example.com", name: "O", organizer: true };
    const links = hrefs(render("/?demo=1"));
    expect(links).toContain("/c/hidden-2028?demo=1");
    expect(links).toContain("/organizer?demo=1");
  });

  it("offers a filter once there are many conferences", () => {
    context.platform.conferences = Array.from({ length: 7 }, (_, index) => conference(`c-${index}`, "live", "2027-01-01"));
    expect(render("/")).toContain("Find your conference");
  });
});

describe("conference header", () => {
  it("names the conference and links organizers to /organizer", () => {
    expect(render("/c/spring-retreat/events")).toContain("Spring Retreat");
    expect(hrefs(render("/c/spring-retreat/events"))).not.toContain("/organizer");
    context.snapshot.identity = { ...context.snapshot.identity!, organizer: true };
    expect(hrefs(render("/c/spring-retreat/events"))).toContain("/organizer");
  });
});
