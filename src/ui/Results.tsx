import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useConference } from "@/lib/ConferenceContext";
import { formatScore, getBestAttempt, overallStandings } from "@/domain/ranking";
import type { Attempt, ConferenceState } from "@/domain/types";
import { AttemptList, myParticipantId } from "./AttemptList";
import { BottomNav, PageShell, RequireIdentity, ordinal, withDemo } from "./shared";
import "./Results.css";

export function isCountingAttempt(
  state: ConferenceState,
  attempt: Attempt,
): boolean {
  return (
    getBestAttempt(state, attempt.eventId, attempt.participantId)?.id ===
    attempt.id
  );
}

export function Results() {
  const { snapshot } = useConference();
  const participantId = myParticipantId(snapshot);
  const attempts = snapshot.data.attempts
    .filter((a) => a.participantId === participantId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const standing = useMemo(
    () => participantId ? overallStandings(snapshot.data).find((row) => row.id === participantId) : undefined,
    [snapshot.data, participantId],
  );
  const bests = snapshot.data.events.flatMap((event) => {
    if (!participantId || !event.active || event.kind === "bracket") return [];
    const attempt = getBestAttempt(snapshot.data, event.id, participantId);
    return attempt ? [{ event, attempt }] : [];
  });
  return (
    <RequireIdentity>
      <PageShell>
        <section className="content">
          <h1>MY RESULTS</h1>
          {standing && standing.rank > 0 && (
            <Link className="results-summary" to={withDemo("/standings")} aria-label={`${ordinal(standing.rank)} overall, ${Number(standing.points.toFixed(2))} points, ${standing.eventsPlayed} events. View standings`}>
              <span><strong>{ordinal(standing.rank)}</strong><small>Overall</small></span>
              <span><strong>{Number(standing.points.toFixed(2))}</strong><small>Points</small></span>
              <span><strong>{standing.eventsPlayed}</strong><small>Events</small></span>
            </Link>
          )}
          {bests.length > 0 && (
            <section className="results-bests" aria-labelledby="results-bests-title">
              <h2 id="results-bests-title">Your best</h2>
              <ul>
                {bests.map(({ event, attempt }) => (
                  <li key={event.id}>
                    <Link to={withDemo(`/events/${event.id}`)}>
                      <span>{event.name}</span>
                      <strong>{formatScore(attempt.value, event)}{event.kind === "duration" ? "" : ` ${event.unit}`}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <h2 className="results-history-title">Every attempt</h2>
          <p className="results-history-note">Every attempt is shown. Your best valid result counts.</p>
          <AttemptList
            state={snapshot.data}
            attempts={attempts}
            emptyText="No attempts recorded yet. Choose an event to get started."
          />
        </section>
        <BottomNav />
      </PageShell>
    </RequireIdentity>
  );
}
