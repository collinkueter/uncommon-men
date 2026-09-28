import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "@/data/seed";
import type { AppSnapshot } from "@/domain/types";
import { AppRoutes } from "./App";

const context = vi.hoisted(() => ({ snapshot: {} as AppSnapshot }));
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

beforeEach(() => {
  location.search = "";
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
    ["/", "/c/uncommon-men-2026"],
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
