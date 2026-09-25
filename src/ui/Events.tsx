import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Clock3,
  Flame,
  Search,
  Trophy,
} from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { formatScore, getBestAttempt, overallStandings } from "@/domain/ranking";
import type { Competition } from "@/domain/types";
import { myParticipantId } from "./AttemptList";
import { BottomNav, Empty, PageShell, ordinal, withDemo, scoreLabel } from "./shared";
import "./Events.css";

const groups: Array<{ title: string; match: (event: Competition) => boolean; Icon: typeof Trophy }> = [
  { title: "Timed", match: (event) => event.kind === "duration", Icon: Clock3 },
  { title: "Reps and distance", match: (event) => event.kind === "count" || event.kind === "distance", Icon: Flame },
  { title: "Brackets", match: (event) => event.kind === "bracket", Icon: Trophy },
  { title: "Group games", match: (event) => event.kind === "knockout", Icon: Trophy },
];

export function Events() {
  const { snapshot } = useConference();
  const [search, setSearch] = useState("");
  const firstName = snapshot.identity?.name?.trim().split(" ")[0];
  const participantId = myParticipantId(snapshot);
  const standing = useMemo(
    () => participantId ? overallStandings(snapshot.data).find((row) => row.id === participantId) : undefined,
    [snapshot.data, participantId],
  );
  const events = snapshot.data.events.filter(
    (event) => event.active && event.name.toLowerCase().includes(search.toLowerCase()),
  );
  const best = (event: Competition) => {
    if (!participantId || event.kind === "bracket" || event.kind === "knockout") return undefined;
    const attempt = getBestAttempt(snapshot.data, event.id, participantId);
    if (!attempt) return undefined;
    return `${formatScore(attempt.value, event)}${event.kind === "duration" ? "" : ` ${event.unit}`}`;
  };
  return (
    <PageShell>
      <section className="content event-list">
        {firstName && (
          <div className="identity-greeting">
            <p>
              Hey, {firstName}
              <Link to={withDemo("/welcome")}>Change name</Link>
            </p>
            {standing && standing.rank > 0 && (
              <Link className="my-standing" to={withDemo("/standings")}>
                <strong>{ordinal(standing.rank)}</strong> overall
                <span>{Number(standing.points.toFixed(2))} pts</span>
                <ChevronRight aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
        <h1>CHOOSE YOUR EVENT</h1>
        <div className="filters">
          <label>
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an event"
              aria-label="Find an event"
            />
          </label>
        </div>
        {snapshot.loading ? (
          <div className="event-group skeleton" aria-busy="true" aria-label="Loading events">
            <span /><span /><span />
          </div>
        ) : events.length ? (
          groups.map(({ title, match, Icon }) => {
            const list = events.filter(match);
            if (!list.length) return null;
            return (
              <section className="event-group" key={title} aria-labelledby={`group-${title}`}>
                <h2 id={`group-${title}`}>{title}</h2>
                <ul>
                  {list.map((event) => {
                    const mine = best(event);
                    return (
                      <li key={event.id}>
                        <Link className="event-row" to={withDemo(`/events/${event.id}`)}>
                          <Icon className="event-icon" aria-hidden="true" />
                          <span className="event-name">
                            <strong>{event.name}</strong>
                            <small>{scoreLabel(event)}</small>
                          </span>
                          {mine && <span className="event-best"><small>Your best</small>{mine}</span>}
                          <ChevronRight className="event-chevron" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        ) : (
          <Empty text="No events match that search." />
        )}
      </section>
      <BottomNav />
    </PageShell>
  );
}
