import { formatScore, getBestAttempt, normalizeName } from "@/domain/ranking";
import type { AppSnapshot, Attempt, ConferenceState } from "@/domain/types";
import { Empty } from "./shared";
import "./Results.css";

/** Resolve a typed competitor only when it is an exact participant name. */
export function participantIdForName(
  state: ConferenceState,
  name: string,
): string | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return state.participants.find((participant) =>
    normalizeName(participant.name) === normalized,
  )?.id;
}

// A device that lost its sign-in session gets a new identity without a
// participant link; fall back to the remembered name so history still shows.
export function myParticipantId(snapshot: AppSnapshot): string | undefined {
  return (
    snapshot.identity?.participantId ??
    participantIdForName(snapshot.data, snapshot.identity?.name ?? "")
  );
}

export function getAttemptsForEventParticipant(
  state: ConferenceState,
  eventId: string,
  participantId: string | undefined,
  participantName: string,
): Attempt[] {
  const resolvedId = participantId ?? participantIdForName(state, participantName);
  if (!resolvedId) return [];
  return state.attempts
    .filter((attempt) =>
      attempt.eventId === eventId && attempt.participantId === resolvedId,
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function AttemptList({
  state,
  attempts,
  emptyText,
}: {
  state: ConferenceState;
  attempts: Attempt[];
  emptyText: string;
}) {
  if (!attempts.length) return <Empty text={emptyText} />;
  return (
    <div className="results-attempt-list">
      {attempts.map((attempt) => {
        const event = state.events.find((item) => item.id === attempt.eventId);
        const counting =
          attempt.valid && event?.active &&
          getBestAttempt(state, attempt.eventId, attempt.participantId)?.id === attempt.id;
        return (
          <article className="results-attempt" key={attempt.id}>
            <div>
              <strong>{event?.name ?? "Event"}</strong>
              <small>{new Date(attempt.createdAt).toLocaleString()}</small>
            </div>
            <b>{event ? formatScore(attempt.value, event) : String(attempt.value)}</b>
            <span className={attempt.valid ? "valid" : "invalid"}>
              {attempt.valid ? "Valid" : "Invalid"}
            </span>
            {counting && (
              <span className="results-badges" aria-label="Best attempt. Counts toward standings.">
                <span className="results-badge">Best attempt</span>
                <small className="results-counting-note">Counts toward standings</small>
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
}
