import type { ButtonHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "@/data/seed";
import { advanceBracket, createBracket } from "@/domain/ranking";
import { Bracket } from "./Bracket";
import type { AppSnapshot } from "@/domain/types";

const context = vi.hoisted(() => ({ snapshot: {} as AppSnapshot, execute: vi.fn() }));
vi.mock("@/lib/ConferenceContext", () => ({ useConference: () => context }));
vi.mock("./shared", () => ({
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  withDemo: (path: string) => path,
  useMediaQuery: () => false,
}));

function renderBracket(eventId = "chess") {
  const event = context.snapshot.data.events.find((item) => item.id === eventId)!;
  return renderToStaticMarkup(<MemoryRouter><Bracket event={event} /></MemoryRouter>);
}

beforeEach(() => {
  const data = createSeedState();
  data.brackets = [createBracket("chess", data.participants.slice(0, 3).map((p) => p.id))];
  context.snapshot = { data, identity: { uid: "test", name: "Test", admin: false }, loading: false, error: null, mode: "demo", connected: true };
});

describe("bracket presentation", () => {
  it("distinguishes an automatic bye from a final awaiting its feeder", () => {
    const html = renderBracket();
    expect(html).toContain("BYE");
    expect(html).toContain("WAITING");
    expect(html).toContain("READY");
    // Only the two-player first-round match can accept a result.
    expect(html.match(/class="match-select"/g)).toHaveLength(1);
  });

  it("shows the champion and offers no completed-match editing to non-admins", () => {
    let bracket = context.snapshot.data.brackets[0];
    for (const round of [1, 2]) {
      for (const match of bracket.matches.filter((m) => m.round === round && !m.bye)) {
        bracket = advanceBracket(bracket, match.id, match.sideA!);
      }
    }
    context.snapshot.data.brackets = [bracket];
    const html = renderBracket();
    expect(html).toContain("BRACKET COMPLETE");
    expect(html).toContain("Caleb Johnson");
    expect(html).not.toContain('class="match-select"');
    expect(html).not.toContain("Save winner");
  });

  it("allows administrators to select completed matches but never byes", () => {
    let bracket = context.snapshot.data.brackets[0];
    const match = bracket.matches.find((m) => m.round === 1 && !m.bye)!;
    bracket = advanceBracket(bracket, match.id, match.sideA!);
    context.snapshot.data.brackets = [bracket];
    context.snapshot.identity!.admin = true;
    expect(renderBracket().match(/class="match-select"/g)).toHaveLength(2);
  });

  it("makes roster setup available before a bracket exists", () => {
    context.snapshot.data.brackets = [];
    context.snapshot.identity!.admin = true;
    const html = renderBracket();
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain('id="bracket-entrants"');
    expect(html).toContain("Start bracket");
  });

  it("shows public registration and persisted entrants without a result editor", () => {
    context.snapshot.data.brackets = [{ id: "carpet-ball-bracket", eventId: "carpet-ball", entrants: [context.snapshot.data.participants[0].id, context.snapshot.data.participants[1].id], matches: [], status: "registration", revision: 1, entrantsOpen: true }];
    const html = renderBracket("carpet-ball");
    expect(html).toContain('id="bracket-entrants"');
    expect(html).toContain("OPEN REGISTRATION");
    expect(html).toContain("Aaron Davis");
    expect(html).toContain("Caleb Johnson");
    expect(html).not.toContain("Save winner");
  });

  it("keeps team registration while requiring an administrator to start teams", () => {
    context.snapshot.data.brackets = [];
    const html = renderBracket("cornhole");
    expect(html).toContain("Save team");
    expect(html).toContain("An administrator must start this bracket after teams are registered.");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("Start bracket");
  });

  it("does not enable start for administrators with unjoined teams", () => {
    context.snapshot.data.brackets = [];
    context.snapshot.identity!.admin = true;
    const html = renderBracket("cornhole");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start bracket<\/button>/);
  });

  it("enables admin start only after saved entrants join", () => {
    const teams = context.snapshot.data.teams.filter((team) => team.eventId === "cornhole");
    context.snapshot.data.brackets = [{ id: "cornhole-bracket", eventId: "cornhole", entrants: teams.slice(0, 2).map((team) => team.id), matches: [], status: "registration", revision: 1, entrantsOpen: true }];
    context.snapshot.identity!.admin = true;
    expect(renderBracket("cornhole")).toMatch(/<button[^>]*>Start bracket<\/button>/);

    const participants = context.snapshot.data.participants.slice(0, 2).map((participant) => participant.id);
    context.snapshot.data.brackets = [{ id: "carpet-ball-bracket", eventId: "carpet-ball", entrants: participants, matches: [], status: "registration", revision: 1, entrantsOpen: true }];
    expect(renderBracket("carpet-ball")).toMatch(/<button[^>]*>Start bracket<\/button>/);
  });

  it("shows public draft joining without start or result controls", () => {
    const participants = context.snapshot.data.participants.slice(0, 2).map((participant) => participant.id);
    context.snapshot.data.brackets = [{ id: "carpet-ball-bracket", eventId: "carpet-ball", entrants: participants, matches: [], status: "registration", revision: 1, entrantsOpen: true }];
    const html = renderBracket("carpet-ball");
    expect(html).toContain("Sign up selected");
    expect(html).not.toContain("Start bracket");
    expect(html).not.toContain('class="match-select"');
  });

  it("shows member details and lets an administrator add an unstarted registered team", () => {
    const teams = context.snapshot.data.teams.filter((team) => team.eventId === "cornhole");
    context.snapshot.data.brackets = [{ ...createBracket("cornhole", teams.slice(0, 2).map((team) => team.id)), entrantsOpen: true }];
    context.snapshot.identity!.admin = true;
    const html = renderBracket("cornhole");
    expect(html).toContain("View members of");
    expect(html).toContain("Caleb Johnson, Marcus Reed");
    expect(html).toContain("Add to bracket");
  });

  it("hides add controls after a result and from non administrators", () => {
    const teams = context.snapshot.data.teams.filter((team) => team.eventId === "cornhole");
    context.snapshot.data.brackets = [{ ...createBracket("cornhole", teams.slice(0, 2).map((team) => team.id)), entrantsOpen: true }];
    context.snapshot.identity!.admin = false;
    expect(renderBracket("cornhole")).not.toContain("Add to bracket");
    let bracket = createBracket("cornhole", teams.slice(0, 2).map((team) => team.id));
    bracket = advanceBracket(bracket, bracket.matches.find((match) => match.sideA && match.sideB)!.id, teams[0].id);
    context.snapshot.data.brackets = [bracket];
    context.snapshot.identity!.admin = true;
    expect(renderBracket("cornhole")).not.toContain("Add to bracket");
    context.snapshot.identity!.admin = false;
    expect(renderBracket("cornhole")).not.toContain("Add to bracket");
  });

  it("hides team creation after start for public viewers", () => {
    const teams = context.snapshot.data.teams.filter((team) => team.eventId === "cornhole");
    context.snapshot.data.brackets = [createBracket("cornhole", teams.slice(0, 2).map((team) => team.id))];
    expect(renderBracket("cornhole")).not.toContain("Save team");
  });

  it("offers one-tap self signup and confirms it once registered", () => {
    const me = context.snapshot.data.participants[0];
    context.snapshot.identity!.participantId = me.id;
    context.snapshot.data.brackets = [];
    expect(renderBracket("carpet-ball")).toContain(`Sign me up as ${me.name}`);
    context.snapshot.data.brackets = [{ id: "carpet-ball-bracket", eventId: "carpet-ball", entrants: [me.id], matches: [], status: "registration", revision: 1, entrantsOpen: true }];
    const html = renderBracket("carpet-ball");
    expect(html).not.toContain("Sign me up");
    expect(html).toContain("You&#x27;re signed up as");
    expect(html).not.toContain("Start bracket");
  });

  it("offers to sign up the viewer's own team and hides signup once started", () => {
    const team = context.snapshot.data.teams.find((item) => item.eventId === "cornhole")!;
    context.snapshot.identity!.participantId = team.memberIds[0];
    context.snapshot.data.brackets = [];
    expect(renderBracket("cornhole")).toContain(`Sign up ${team.name}`);
    context.snapshot.data.brackets = [createBracket("cornhole", [team.id, context.snapshot.data.teams.find((item) => item.eventId === "cornhole" && item.id !== team.id)!.id])];
    expect(renderBracket("cornhole")).not.toContain('id="bracket-signup-title"');
  });

  it("asks for a name before signup", () => {
    context.snapshot.identity = null;
    context.snapshot.data.brackets = [];
    expect(renderBracket("carpet-ball")).toContain("Enter your name");
  });

  it("shows participant additions only to admins before the first result", () => {
    const participants = context.snapshot.data.participants.slice(0, 2).map((participant) => participant.id);
    context.snapshot.data.brackets = [createBracket("carpet-ball", participants)];
    context.snapshot.identity!.admin = true;
    expect(renderBracket("carpet-ball")).toContain("Add to bracket");
    context.snapshot.identity!.admin = false;
    expect(renderBracket("carpet-ball")).not.toContain("Add to bracket");
  });
});
