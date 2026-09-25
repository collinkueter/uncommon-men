import { useConference } from "@/lib/ConferenceContext";
import { getBestAttempt } from "@/domain/ranking";
import type { Attempt, ConferenceState } from "@/domain/types";
import { AttemptList, participantIdForName } from "./AttemptList";
import { BottomNav, PageShell, RequireIdentity } from "./shared";
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
  // A device that lost its sign-in session gets a new identity without a
  // participant link; fall back to the remembered name so history still shows.
  const participantId =
    snapshot.identity?.participantId ??
    participantIdForName(snapshot.data, snapshot.identity?.name ?? "");
  const attempts = snapshot.data.attempts
    .filter((a) => a.participantId === participantId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <RequireIdentity>
      <PageShell>
        <section className="content">
          <h1>MY RESULTS</h1>
          <p>Every attempt is shown. Your best valid result counts.</p>
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
