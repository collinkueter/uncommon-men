import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Clock3,
  Flame,
  Search,
  Trophy,
} from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { BottomNav, Empty, PageShell, withDemo, scoreLabel } from "./shared";

export function Events() {
  const { snapshot } = useConference();
  const [search, setSearch] = useState("");
  const activeEvents = snapshot.data.events.filter((event) => event.active);
  const events = activeEvents.filter(
    (event) => event.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <PageShell>
      <section className="content event-list">
        <div className="identity-greeting">
          Hey, {snapshot.identity?.name?.split(" ")[0] ?? "there"}{" "}
          <Link to={withDemo("/welcome")}>Change name</Link>
        </div>
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
        {events.length ? (
          <div className="events-grid">
            {events.map((event) => (
              <Link
                className="event-card"
                key={event.id}
                to={withDemo(`/events/${event.id}`)}
              >
                <span className="event-icon">
                  {event.kind === "bracket" ? (
                    <Trophy />
                  ) : event.kind === "duration" ? (
                    <Clock3 />
                  ) : (
                    <Flame />
                  )}
                </span>
                <span>
                  <strong>{event.name}</strong>
                </span>
                <b>{scoreLabel(event)}</b>
                <ChevronRight />
              </Link>
            ))}
          </div>
        ) : (
          <Empty text="No events match that search." />
        )}
      </section>
      <BottomNav />
    </PageShell>
  );
}
