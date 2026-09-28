import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import "@fontsource/barlow/latin-700.css";
import { Printer, ShieldCheck } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { conferenceSignUrl, eventSignUrl, scoringSummary } from "@/domain/signs";
import type { Competition } from "@/domain/types";
import { Button, PageShell } from "./shared";
import { SignQr } from "./SignQr";
import "./Signs.css";

function formatLine(event: Competition): string {
  if (event.kind === "bracket")
    return event.team ? `${event.teamSize}-person team bracket` : "Individual bracket";
  if (event.kind === "knockout") return "Individual elimination game";
  return event.team ? `Team attempt (team of ${event.teamSize})` : "Individual attempt";
}

function whatWeRecord(event: Competition): string {
  const summary = scoringSummary(event);
  if (event.kind === "bracket")
    return event.team ? "Winning team for each bracket match." : "Winner of each bracket match.";
  if (event.kind === "knockout") return "Winner of the game.";
  const unit = event.unit.trim() || "reps";
  if (event.kind === "duration") return `Elapsed time in ${unit}. ${summary}`;
  if (event.kind === "distance") return `Distance in ${unit}. ${summary}`;
  return `Number of valid ${unit}. ${summary}`;
}

function EventSign({
  event,
  categoryName,
  url,
  index,
  total,
}: {
  event: Competition;
  categoryName: string | undefined;
  url: string;
  index: number;
  total: number;
}) {
  return (
    <article className="sign-sheet" aria-label={`${event.name} event sign`}>
      <header className="sign-top">
        <div>
          <div className="sign-brand">
            UNCOMMON <em>MEN</em>
          </div>
          <div className="sign-brand-rule" />
        </div>
        <div className="sign-top-label">
          {categoryName ? `${categoryName}\nEvent guide` : "Event guide"}
        </div>
      </header>
      <div className="sign-content">
        <h1>{event.name}</h1>
        <h2 className="sign-how-label">How to play</h2>
        <p className="sign-lead">
          {event.instructions.trim() || "See an administrator for the rules of this event."}
        </p>
        <div className="sign-result-box">
          <h2>What we record</h2>
          <p>{whatWeRecord(event)}</p>
        </div>
        <p className="sign-format">
          <strong>Format:</strong> {formatLine(event)}
        </p>
        {event.kind === "duration" && (
          <p className="sign-timing-note">
            No stopwatch or timer? Use the built-in stopwatch on this event's app page.
          </p>
        )}
        <div className="sign-spacer" />
        <div className="sign-cta">
          <div>
            <h2>Open this event</h2>
            <p>The QR opens this event directly. Or type the URL and choose it from the list.</p>
            <span className="sign-url">{url}</span>
          </div>
          <SignQr url={url} label={`QR code for ${event.name}`} />
        </div>
        <div className="sign-footer">
          <strong>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </strong>
        </div>
      </div>
    </article>
  );
}

export function ConferencePoster({ url, name }: { url: string; name: string }) {
  return (
    <article className="sign-sheet sign-poster" aria-label="Conference poster">
      <header className="sign-top">
        <div>
          <div className="sign-brand">
            UNCOMMON <em>MEN</em>
          </div>
          <div className="sign-brand-rule" />
        </div>
        <div className="sign-top-label">Event guide</div>
      </header>
      <div className="sign-content sign-poster-content">
        <h1 className="sign-poster-title">{name}</h1>
        <p className="sign-poster-lead">Scan to enter scores and see live standings.</p>
        <div className="sign-spacer" />
        <div className="sign-cta sign-poster-cta">
          <div>
            <h2>Get started</h2>
            <p>Scan the code, choose your event, and enter your best result.</p>
            <span className="sign-url">{url}</span>
          </div>
          <SignQr url={url} label={`QR code for ${name} events`} />
        </div>
      </div>
    </article>
  );
}

export function Signs({
  conferenceSlug: conferenceSlugProp,
  conferenceName: conferenceNameProp,
}: {
  conferenceSlug?: string | null;
  conferenceName?: string;
}) {
  const { snapshot, signInAdmin } = useConference();
  const params = useParams<{ slug?: string }>();
  const conferenceSlug = conferenceSlugProp ?? params.slug ?? null;
  const conferenceName = conferenceNameProp ?? snapshot.conference?.name ?? "Uncommon Men";
  const activeEvents = useMemo(
    () => snapshot.data.events.filter((event) => event.active),
    [snapshot.data.events],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(activeEvents.map((event) => event.id)),
  );
  useEffect(() => {
    setSelected((prev) => {
      const activeIds = new Set(activeEvents.map((event) => event.id));
      const next = new Set([...prev].filter((id) => activeIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [activeEvents]);
  const [includePoster, setIncludePoster] = useState(false);
  const [pendingPrint, setPendingPrint] = useState(false);

  useEffect(() => {
    if (!pendingPrint) return;
    setPendingPrint(false);
    window.print();
  }, [pendingPrint, selected, includePoster]);

  if (!snapshot.identity?.admin)
    return (
      <PageShell>
        <section className="admin-login">
          <ShieldCheck />
          <h1>ADMIN ACCESS</h1>
          <p>Sign in with an authorized Google account to print event signs.</p>
          <Button type="button" className="primary" onClick={signInAdmin}>
            {snapshot.mode === "demo" ? "Enter demo admin" : "Sign in with Google"}
          </Button>
        </section>
      </PageShell>
    );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = activeEvents.length > 0 && selected.size === activeEvents.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(activeEvents.map((event) => event.id)));
  const printSelected = () => window.print();
  const printAll = () => {
    setSelected(new Set(activeEvents.map((event) => event.id)));
    setIncludePoster(true);
    setPendingPrint(true);
  };
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://uncommon-men.web.app";
  const selectedEvents = activeEvents.filter((event) => selected.has(event.id));
  const nothingToPrint = selectedEvents.length === 0 && !includePoster;

  return (
    <PageShell>
      <section className="signs-page">
        <div className="signs-controls">
          <h1>EVENT SIGNS</h1>
          <p>
            Select the active events to print. Each sign is one letter-size page with a QR
            code that opens straight into that event.
          </p>
          <label className="signs-select-all check">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Select all ({activeEvents.length})
          </label>
          <ul className="signs-list">
            {activeEvents.map((event) => (
              <li key={event.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(event.id)}
                    onChange={() => toggle(event.id)}
                  />
                  {event.name}
                </label>
              </li>
            ))}
          </ul>
          <label className="check signs-poster-toggle">
            <input
              type="checkbox"
              checked={includePoster}
              onChange={(e) => setIncludePoster(e.target.checked)}
            />
            Conference poster
          </label>
          <div className="signs-actions">
            <Button
              type="button"
              className="primary"
              disabled={nothingToPrint}
              onClick={printSelected}
            >
              <Printer aria-hidden="true" /> Print selected
            </Button>
            <Button type="button" onClick={printAll} disabled={activeEvents.length === 0}>
              Print all
            </Button>
          </div>
        </div>
        <div className="signs-print-area">
          {includePoster && (
            <ConferencePoster
              url={conferenceSignUrl(origin, conferenceSlug)}
              name={conferenceName}
            />
          )}
          {selectedEvents.map((event, index) => (
            <EventSign
              key={event.id}
              event={event}
              categoryName={
                snapshot.data.categories.find((c) => c.id === event.categoryId)?.name
              }
              url={eventSignUrl(origin, conferenceSlug, event.id)}
              index={index}
              total={selectedEvents.length}
            />
          ))}
        </div>
      </section>
    </PageShell>
  );
}
