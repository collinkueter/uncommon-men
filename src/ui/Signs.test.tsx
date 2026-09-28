import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "@/data/seed";
import type { AppSnapshot } from "@/domain/types";
import { ConferencePoster, Signs } from "./Signs";

const context = vi.hoisted(() => ({
  snapshot: {} as AppSnapshot,
  signInAdmin: vi.fn(),
}));
vi.mock("@/lib/ConferenceContext", () => ({ useConference: () => context }));
vi.mock("./shared", () => ({
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("./SignQr", () => ({
  SignQr: ({ url, label }: { url: string; label: string }) => (
    <div data-qr-url={url} aria-label={label} />
  ),
}));

function renderSigns(props: { conferenceSlug?: string | null; conferenceName?: string } = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Signs {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  const data = createSeedState();
  context.snapshot = {
    data,
    identity: { uid: "admin", name: "Admin", admin: true },
    loading: false,
    identityLoading: false,
    error: null,
    mode: "demo",
    connected: true,
    conferenceId: "uncommon-men-2026",
    conference: null,
    conferenceState: "ready",
  };
  context.signInAdmin.mockReset();
});

describe("Signs", () => {
  it("requires admin access, like the Admin page", () => {
    context.snapshot.identity = { uid: "guest", name: "Guest", admin: false };
    const html = renderSigns();
    expect(html).toContain("ADMIN ACCESS");
    expect(html).not.toContain("EVENT SIGNS");
  });

  it("renders one sign per active event by default, excluding inactive events", () => {
    context.snapshot.data.events = context.snapshot.data.events.map((event) =>
      event.id === "sudoku" ? { ...event, active: false } : event,
    );
    const html = renderSigns();
    const activeEvents = context.snapshot.data.events.filter((event) => event.active);
    for (const event of activeEvents) {
      expect(html).toContain(`${event.name} event sign`);
    }
    expect(html.match(/class="sign-sheet"/g)?.length).toBe(activeEvents.length);
    expect(html).not.toContain("Sudoku");
  });

  it("points each sign's QR at the legacy per-event URL with no conference slug", () => {
    const html = renderSigns();
    const pushUp = context.snapshot.data.events.find((event) => event.id === "push-up")!;
    expect(html).toContain('data-qr-url="https://uncommon-men.web.app/events/push-up"');
    expect(pushUp).toBeDefined();
  });

  it("points signs at the /c/:slug URL when a conference slug is given", () => {
    const html = renderSigns({ conferenceSlug: "uncommon-men-2026" });
    expect(html).toContain(
      'data-qr-url="https://uncommon-men.web.app/c/uncommon-men-2026/events/push-up"',
    );
  });

  it("does not render the conference poster unless it is selected", () => {
    const html = renderSigns();
    expect(html).not.toContain("sign-poster");
  });
});

describe("ConferencePoster", () => {
  it("shows the conference name as a large heading and a QR to the events list", () => {
    const html = renderToStaticMarkup(
      <ConferencePoster url="https://uncommon-men.web.app/events" name="Uncommon Men" />,
    );
    expect(html).toContain("Uncommon Men");
    expect(html).toContain("Scan to enter scores and see live standings.");
    expect(html).toContain('data-qr-url="https://uncommon-men.web.app/events"');
  });

  it("falls back to a passed-in name for other conferences", () => {
    const html = renderToStaticMarkup(
      <ConferencePoster
        url="https://uncommon-men.web.app/c/spring-2027/events"
        name="Spring Games"
      />,
    );
    expect(html).toContain("Spring Games");
  });
});
