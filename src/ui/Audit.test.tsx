import { describe, expect, it } from "vitest";
import { createSeedState } from "@/data/seed";
import type { AuditEntry } from "@/domain/types";
import { describeAuditEntry } from "./Audit";

describe("audit summaries", () => {
  it("resolves a partial correction to an event and participant", () => {
    const state = createSeedState();
    const entry: AuditEntry = {
      id: "push-up-correction",
      action: "correctAttempt",
      entityType: "attempts",
      entityId: "missing-attempt",
      actorUid: "admin",
      actorName: "Admin",
      at: 1,
      before: { eventId: "push-up", participantId: "demo-p2", value: 23, valid: true },
      after: { eventId: "push-up", participantId: "demo-p2", value: 28, valid: true },
      reason: "Recount verified",
    };
    expect(describeAuditEntry(entry, state)).toContain("Push Up");
    expect(describeAuditEntry(entry, state)).toContain("Marcus Reed");
    expect(describeAuditEntry(entry, state)).toContain("23 reps → 28 reps");
  });

  it("describes bracket winner changes with the team name", () => {
    const state = createSeedState();
    const bracket = state.brackets[0];
    const match = bracket.matches.find((item) => item.winnerId);
    expect(match).toBeDefined();
    const entry: AuditEntry = {
      id: "winner",
      action: "matchWinner",
      entityType: "brackets",
      entityId: bracket.id,
      actorUid: "admin",
      actorName: "Admin",
      at: 1,
      before: { ...bracket, matches: bracket.matches.map((item) => ({ ...item, winnerId: null })) },
      after: bracket,
      reason: "Winner selected",
    };
    expect(describeAuditEntry(entry, state)).toContain("won round");
    expect(describeAuditEntry(entry, state)).toContain("match 1");
  });

  it("resolves individual bracket winners and numeric match details", () => {
    const state = createSeedState();
    const event = { ...state.events.find((item) => item.id === "push-up")!, kind: "bracket" as const, team: false };
    state.events = [...state.events, event];
    const bracket = {
      id: "individual-bracket",
      eventId: event.id,
      entrants: ["demo-p1", "demo-p2"],
      matches: [{ id: "m1", round: 1, position: 0, sideA: "demo-p1", sideB: "demo-p2", winnerId: "demo-p1", bye: false }],
      status: "active" as const,
      revision: 1,
    };
    const entry: AuditEntry = { id: "individual-winner", action: "matchWinner", entityType: "brackets", entityId: bracket.id, actorUid: "admin", actorName: "Admin", at: 1, before: { ...bracket, matches: [{ ...bracket.matches[0], winnerId: null }] }, after: bracket, reason: "Winner selected" };
    expect(describeAuditEntry(entry, state)).toContain("Caleb Johnson won round");
    expect(describeAuditEntry(entry, state)).toContain("round 1, match 1");
  });

  it("calls out validity-only corrections", () => {
    const state = createSeedState();
    const attempt = state.attempts[0];
    const entry: AuditEntry = { id: "invalidate", action: "correctAttempt", entityType: "attempts", entityId: attempt.id, actorUid: "admin", actorName: "Admin", at: 1, before: { ...attempt }, after: { ...attempt, valid: false }, reason: "Invalid review" };
    expect(describeAuditEntry(entry, state)).toContain("invalidated");
  });

  it("does not call a newly submitted valid attempt restored", () => {
    const state = createSeedState();
    const entry: AuditEntry = { id: "attempt", action: "attempt", entityType: "attempts", entityId: "new", actorUid: "operator", actorName: "Operator", at: 1, before: null, after: { eventId: "push-up", participantId: "demo-p1", value: 10, valid: true }, reason: "Result submitted" };
    expect(describeAuditEntry(entry, state)).not.toContain("restored");
  });
});
