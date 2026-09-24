import { useConference } from "@/lib/ConferenceContext";
import { getBestAttempt } from "@/domain/ranking";
import type { Attempt, ConferenceState } from "@/domain/types";
import { AttemptList } from "./AttemptList";
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
  const participantId = snapshot.identity?.participantId;
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
