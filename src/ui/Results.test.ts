import { describe, expect, it } from "vitest";
import { createSeedState } from "@/data/seed";
import { isCountingAttempt } from "./Results";
import { getAttemptsForEventParticipant } from "./AttemptList";

describe("results counting marker", () => {
  it("marks only the exact best valid attempt, including ties", () => {
    const state = createSeedState();
    const best = state.attempts.find((attempt) => attempt.eventId === "dumbbell-hold-15-lb" && attempt.participantId === "demo-p1")!;
    state.attempts.push({ ...best, id: "earlier-dumbbell", value: 40, createdAt: best.createdAt - 1 });
    const attempts = state.attempts.filter(
      (attempt) => attempt.eventId === "dumbbell-hold-15-lb" && attempt.participantId === "demo-p1",
    ).sort((a, b) => a.value - b.value);
    expect(isCountingAttempt(state, attempts[0])).toBe(false);
    expect(isCountingAttempt(state, attempts[1])).toBe(true);
    const tie = { ...attempts[1], id: "tie", createdAt: attempts[1].createdAt + 1 };
    state.attempts.push(tie);
    expect(isCountingAttempt(state, attempts[1])).toBe(true);
    expect(isCountingAttempt(state, tie)).toBe(false);
  });

  it("handles invalid attempts and lower-is-better events", () => {
    const state = createSeedState();
    const invalid = { ...state.attempts[0], id: "invalid", valid: false, value: 999 };
    state.attempts.push(invalid);
    expect(isCountingAttempt(state, invalid)).toBe(false);
    const lowerAttempts = state.attempts.filter(
      (attempt) => attempt.eventId === "pound-the-nail",
    );
    const slower = { ...lowerAttempts[0], id: "slower", value: 99 };
    state.attempts.push(slower);
    expect(isCountingAttempt(state, lowerAttempts[0])).toBe(true);
    expect(isCountingAttempt(state, slower)).toBe(false);
  });

  it("filters inline history by both event and participant", () => {
    const state = createSeedState();
    const best = state.attempts.find((attempt) => attempt.eventId === "dumbbell-hold-15-lb" && attempt.participantId === "demo-p1")!;
    state.attempts.push({ ...best, id: "earlier-dumbbell", value: 40, createdAt: best.createdAt - 1 });
    const attempts = getAttemptsForEventParticipant(
      state,
      "dumbbell-hold-15-lb",
      "demo-p1",
      "Caleb Johnson",
    );
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((attempt) =>
      attempt.eventId === "dumbbell-hold-15-lb" && attempt.participantId === "demo-p1",
    )).toBe(true);
    expect(attempts[0].createdAt).toBeGreaterThanOrEqual(attempts[1].createdAt);
  });

  it("uses exact normalized names and does not show another competitor history", () => {
    const state = createSeedState();
    const exact = getAttemptsForEventParticipant(state, "dumbbell-hold-15-lb", undefined, " caleb   johnson ");
    const changed = getAttemptsForEventParticipant(state, "dumbbell-hold-15-lb", undefined, "Caleb Johnson Jr");
    expect(exact.length).toBeGreaterThan(0);
    expect(changed).toEqual([]);
  });
});
