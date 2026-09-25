import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "@/data/seed";
import type { AppSnapshot } from "@/domain/types";
import { Knockout } from "./Knockout";

const context = vi.hoisted(() => ({ snapshot: {} as AppSnapshot, execute: vi.fn() }));
vi.mock("@/lib/ConferenceContext", () => ({ useConference: () => context }));
vi.mock("./shared", () => ({
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Empty: ({ text }: { text: string }) => <p>{text}</p>,
  withDemo: (path: string) => path,
}));

function renderGame() {
  const event = context.snapshot.data.events.find((item) => item.id === "lightning-knockout")!;
  return renderToStaticMarkup(<MemoryRouter><Knockout event={event} /></MemoryRouter>);
}

beforeEach(() => {
  const data = createSeedState();
  context.snapshot = { data, identity: { uid: "test", name: "Test", admin: false }, loading: false, error: null, mode: "demo", connected: true };
  context.execute.mockReset();
});

describe("knockout presentation", () => {
  it("treats a missing game as open signup and has no bracket controls", () => {
    context.snapshot.data.games = [];
    const html = renderGame();
    expect(html).toContain("SIGN UP");
    expect(html).toContain("Sign up someone else");
    expect(html).not.toContain("Start bracket");
    expect(html).not.toContain("BRACKET");
  });

  it("defaults signup to the viewer and confirms it once registered", () => {
    const me = context.snapshot.data.participants[3];
    context.snapshot.identity!.participantId = me.id;
    expect(renderGame()).toContain(`Sign me up as ${me.name}`);
    context.snapshot.data.games[0].entrants.push(me.id);
    const html = renderGame();
    expect(html).not.toContain("Sign me up");
    expect(html).toContain("You&#x27;re signed up as");
    expect(html).not.toContain("Start game");
  });

  it("does not list the whole roster until someone searches", () => {
    const html = renderGame();
    const unregistered = context.snapshot.data.participants.find((p) => !context.snapshot.data.games[0].entrants.includes(p.id))!;
    expect(html).not.toContain(unregistered.name);
    expect(html).toContain('role="combobox"');
  });

  it("shows a saved roster and a single winner choice while active", () => {
    const game = context.snapshot.data.games[0];
    game.status = "active";
    const html = renderGame();
    expect(html).toContain("RECORD WINNER");
    expect(html).toContain("REGISTERED ENTRANTS");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain("Save winner");
  });

  it("shows the completed winner but hides correction from non-admins", () => {
    const game = context.snapshot.data.games[0];
    game.status = "complete";
    game.winnerId = game.entrants[0];
    const html = renderGame();
    expect(html).toContain("GAME COMPLETE");
    expect(html).toContain("Winner: <strong>Caleb Johnson</strong>");
    expect(html).not.toContain("Correct winner");
  });

  it("allows administrators to correct a completed winner with a reason", () => {
    const game = context.snapshot.data.games[0];
    game.status = "complete";
    game.winnerId = game.entrants[0];
    context.snapshot.identity!.admin = true;
    const html = renderGame();
    expect(html).toContain("Correct winner");
    expect(html).toContain("Reason for correction");
    expect(html).toContain("Save correction");
  });
});
