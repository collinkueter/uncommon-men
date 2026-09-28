import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, MapPin, Search } from "lucide-react";
import {
  DIRECTORY_FILTER_THRESHOLD,
  directorySections,
  formatDateRange,
} from "@/domain/conferences";
import type { Conference } from "@/domain/types";
import { conferencePath } from "@/lib/conferencePaths";
import { usePlatform } from "@/lib/PlatformContext";
import { PlatformShell } from "./PlatformShell";
import { withDemo } from "./shared";

export function ConferenceCard({ conference }: { conference: Conference }) {
  const dates = formatDateRange(conference.startDate, conference.endDate);
  return (
    <Link className={`conference-card ${conference.status}`} to={withDemo(conferencePath(conference.id))}>
      <div>
        <strong>{conference.name}</strong>
        <small>
          {dates && (
            <span>
              <CalendarDays aria-hidden="true" />
              {dates}
            </span>
          )}
          {conference.location && (
            <span>
              <MapPin aria-hidden="true" />
              {conference.location}
            </span>
          )}
        </small>
      </div>
      {conference.status !== "live" && <em className={`status-badge ${conference.status}`}>{conference.status}</em>}
      <ChevronRight className="chevron" aria-hidden="true" />
    </Link>
  );
}

function Section({ title, items, note }: { title: string; items: Conference[]; note?: string }) {
  if (!items.length) return null;
  return (
    <section className="directory-section" aria-label={title}>
      <h2>{title}</h2>
      {note && <p className="directory-note">{note}</p>}
      <div className="conference-list">
        {items.map((conference) => (
          <ConferenceCard key={conference.id} conference={conference} />
        ))}
      </div>
    </section>
  );
}

/** `/`: every conference the viewer may see, live ones first, then past ones. */
export function Directory() {
  const { snapshot } = usePlatform();
  const [query, setQuery] = useState("");
  const organizer = Boolean(snapshot.identity?.organizer);
  const sections = directorySections(snapshot.conferences, organizer, query);
  const all = directorySections(snapshot.conferences, organizer);
  const visibleCount = all.current.length + all.past.length + all.drafts.length;
  const nothing = !sections.current.length && !sections.past.length && !sections.drafts.length;
  return (
    <PlatformShell>
      <section className="content directory">
        <h1>CONFERENCES</h1>
        <p className="directory-lede">Choose your conference to enter results and follow the standings.</p>
        {visibleCount > DIRECTORY_FILTER_THRESHOLD && (
          <div className="filters">
            <label>
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find your conference"
                aria-label="Find your conference"
              />
            </label>
          </div>
        )}
        {snapshot.conferencesLoading ? (
          <div className="route-pending" aria-busy="true" />
        ) : nothing ? (
          <p className="directory-empty">
            {query ? `No conference matches “${query}”.` : "No conferences are open yet."}
          </p>
        ) : (
          <>
            <Section title="Live & upcoming" items={sections.current} />
            <Section
              title="Drafts"
              items={sections.drafts}
              note="Only organizers and the conference's admins can open a draft."
            />
            <Section title="Past conferences" items={sections.past} />
          </>
        )}
        {organizer && (
          <p className="directory-organizer">
            <Link to={withDemo("/organizer")}>Manage conferences and roles</Link>
          </p>
        )}
      </section>
    </PlatformShell>
  );
}
