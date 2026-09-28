import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { directorySections } from "@/domain/conferences";
import { conferencePath } from "@/lib/conferencePaths";
import { usePlatform } from "@/lib/PlatformContext";
import { withDemo } from "./shared";

// Loaded only when the switcher opens, so conference pages do not listen to
// the conference list until someone asks for it.
function ConferenceOptions({ currentId, organizer }: { currentId: string; organizer: boolean }) {
  const { snapshot } = usePlatform();
  const sections = directorySections(snapshot.conferences, organizer || Boolean(snapshot.identity?.organizer));
  const items = [...sections.current, ...sections.drafts, ...sections.past];
  return (
    <>
      {snapshot.conferencesLoading && <li className="muted">Loading…</li>}
      {items.map((conference) => (
        <li key={conference.id}>
          <Link
            to={withDemo(conferencePath(conference.id))}
            aria-current={conference.id === currentId ? "page" : undefined}
          >
            <span>{conference.name}</span>
            {conference.status !== "live" && <small>{conference.status}</small>}
            {conference.id === currentId && <Check aria-hidden="true" />}
          </Link>
        </li>
      ))}
    </>
  );
}

/** The current conference's name in the header, opening a list of the others. */
export function ConferenceSwitcher({
  conferenceId,
  name,
  organizer,
}: {
  conferenceId: string;
  name: string;
  organizer: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="conference-switcher" ref={root}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="conference-switcher-list"
        onClick={() => setOpen(!open)}
        title="Switch conference"
      >
        <span>{name}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <ul id="conference-switcher-list" aria-label="Conferences">
          <ConferenceOptions currentId={conferenceId} organizer={organizer} />
          <li className="all">
            <Link to={withDemo("/")}>All conferences</Link>
          </li>
        </ul>
      )}
    </div>
  );
}
