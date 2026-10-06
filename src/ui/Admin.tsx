import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CalendarDays,
  Clock3,
  Download,
  Hash,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  QrCode,
  Ruler,
  Search,
  Settings,
  ShieldCheck,
  Swords,
  Timer,
  Trophy,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  eventAlreadyPresent,
  latestConference,
  planCatalogImport,
  statusAction,
  type CatalogCopy,
} from "@/domain/conferences";
import { usePlatform } from "@/lib/PlatformContext";
import { ConferenceAdmins, ConferenceDetailsForm } from "./ConferenceManagement";
import { useConference } from "@/lib/ConferenceContext";
import { formatScore } from "@/domain/ranking";
import type {
  AppSnapshot,
  Attempt,
  Competition,
  ConferenceStore,
  Participant,
} from "@/domain/types";
import { Audit, Button, PageShell, nowId, useConferenceLink, withDemo } from "./shared";
import { ThemedSelect } from "./ThemedSelect";

const KIND_LABELS: Record<Competition["kind"], string> = {
  count: "Count",
  duration: "Duration",
  distance: "Distance",
  bracket: "Bracket",
  knockout: "Single-winner game",
};

function ParticipantRow({
  participant,
  snapshot,
  execute,
  onCorrect,
}: {
  participant: Participant;
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
  onCorrect: (attempt: Attempt) => void;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "results">("idle");
  const [name, setName] = useState(participant.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const attempts = snapshot.data.attempts.filter((a) => a.participantId === participant.id);
  const teams = snapshot.data.teams.filter((t) => t.memberIds.includes(participant.id));
  const eventFor = (id: string) => snapshot.data.events.find((e) => e.id === id);
  const rename = async () => {
    const next = name.trim();
    if (saving || !next) return;
    if (next === participant.name) {
      setMode("idle");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await execute({
        type: "renameParticipant",
        id: participant.id,
        name: next,
        reason: "Administrator rename",
      });
      setMode("idle");
    } catch {
      setError("Could not rename this participant.");
    } finally {
      setSaving(false);
    }
  };
  const meta = [
    `${attempts.length} ${attempts.length === 1 ? "result" : "results"}`,
    teams.length ? `${teams.length} ${teams.length === 1 ? "team" : "teams"}` : "",
  ].filter(Boolean);
  return (
    <article className={`admin-row${mode !== "idle" ? " open" : ""}`}>
      <div className="admin-row-head">
        <div className="admin-row-main">
          <strong>{participant.name}</strong>
          <small>{meta.join(" · ")}</small>
        </div>
        <div className="admin-row-actions">
          <Button
            type="button"
            className={`compact${mode === "results" ? " active" : ""}`}
            aria-expanded={mode === "results"}
            disabled={!attempts.length}
            onClick={() => setMode(mode === "results" ? "idle" : "results")}
          >
            <ListChecks aria-hidden="true" /> Results
          </Button>
          <Button
            type="button"
            className={`compact${mode === "rename" ? " active" : ""}`}
            aria-expanded={mode === "rename"}
            onClick={() => {
              setName(participant.name);
              setError("");
              setMode(mode === "rename" ? "idle" : "rename");
            }}
          >
            <Pencil aria-hidden="true" /> Rename
          </Button>
        </div>
      </div>
      {mode === "rename" && (
        <form
          className="admin-row-panel admin-inline-form"
          onSubmit={(event) => { event.preventDefault(); void rename(); }}
        >
          <input
            aria-label={`New name for ${participant.name}`}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" className="primary" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" onClick={() => setMode("idle")}>Cancel</Button>
          {error && <p className="form-message">{error}</p>}
        </form>
      )}
      {mode === "results" && (
        <ul className="admin-row-panel admin-attempts">
          {attempts.map((attempt) => {
            const event = eventFor(attempt.eventId);
            return (
              <li key={attempt.id}>
                <div>
                  <span>{event?.name ?? "Unknown event"}</span>
                  <small>{new Date(attempt.createdAt).toLocaleString()}</small>
                </div>
                <strong className={attempt.valid ? "" : "invalid"}>
                  {event ? formatScore(attempt.value, event) : attempt.value}
                  {!attempt.valid && " · invalid"}
                </strong>
                <Button type="button" className="compact" onClick={() => onCorrect(attempt)}>
                  Correct
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function AdminParticipants({
  snapshot,
  execute,
  onCorrect,
}: {
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
  onCorrect: (attempt: Attempt) => void;
}) {
  const [newParticipantName, setNewParticipantName] = useState("");
  const [participantSaving, setParticipantSaving] = useState(false);
  const [participantError, setParticipantError] = useState("");
  const [participantSuccess, setParticipantSuccess] = useState("");
  const [query, setQuery] = useState("");
  const addParticipant = async () => {
    const name = newParticipantName.trim();
    if (participantSaving || !name) return;
    setParticipantSaving(true);
    setParticipantError("");
    setParticipantSuccess("");
    try {
      await execute({ type: "addParticipant", name });
      setNewParticipantName("");
      setParticipantSuccess(`${name} added.`);
    } catch {
      setParticipantError("Could not add that participant.");
    } finally {
      setParticipantSaving(false);
    }
  };
  const needle = query.trim().toLowerCase();
  const participants = [...snapshot.data.participants]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((p) => !needle || p.name.toLowerCase().includes(needle));
  return (
    <>
      <h1>PARTICIPANTS</h1>
      <p className="muted">
        {snapshot.data.participants.length} registered. Add someone here so they can be selected for teams and brackets.
      </p>
      <form
        className="admin-inline-form"
        onSubmit={(event) => { event.preventDefault(); void addParticipant(); }}
      >
        <input
          aria-label="Participant name"
          value={newParticipantName}
          onChange={(event) => setNewParticipantName(event.target.value)}
          placeholder="Full name"
        />
        <Button
          type="submit"
          className="primary"
          disabled={participantSaving || !newParticipantName.trim()}
        >
          <UserPlus aria-hidden="true" /> {participantSaving ? "Adding…" : "Add"}
        </Button>
      </form>
      {participantError && <p className="form-message">{participantError}</p>}
      {participantSuccess && <p className="form-message" role="status">{participantSuccess}</p>}
      <h2>ALL PARTICIPANTS</h2>
      {snapshot.data.participants.length > 0 && (
        <div className="filters">
          <label>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a participant"
              aria-label="Find a participant"
            />
          </label>
        </div>
      )}
      {participants.length ? (
        <div className="admin-list">
          {participants.map((p) => (
            <ParticipantRow
              key={p.id}
              participant={p}
              snapshot={snapshot}
              execute={execute}
              onCorrect={onCorrect}
            />
          ))}
        </div>
      ) : (
        <p className="empty">
          {needle ? `No participants match “${query.trim()}”.` : "No participants yet."}
        </p>
      )}
    </>
  );
}
/** Copies events (and the categories they need) from another conference. */
function ImportEvents({
  snapshot,
  execute,
  onDone,
}: {
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
  onDone: () => void;
}) {
  const { snapshot: platform, store } = usePlatform();
  const others = platform.conferences.filter((item) => item.id !== snapshot.conferenceId);
  const [picked, setPicked] = useState<string | null>(null);
  const source = picked ?? latestConference(others)?.id ?? "";
  const [catalog, setCatalog] = useState<CatalogCopy | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const target = snapshot.data;
  useEffect(() => {
    if (!source) return;
    let current = true;
    setCatalog(null);
    setLoadError("");
    store.readCatalog(source).then(
      (result) => {
        if (!current) return;
        setCatalog(result);
        setSelected(
          new Set(
            result.events
              .filter((event) => event.active && !eventAlreadyPresent(event, target))
              .map((event) => event.id),
          ),
        );
      },
      (reason: unknown) => {
        if (current) setLoadError(reason instanceof Error ? reason.message : "Could not load those events.");
      },
    );
    return () => {
      current = false;
    };
    // The target only seeds the default selection; reloading on every
    // snapshot change would wipe the organizer's picks.
  }, [source, store]);
  const sourceName = others.find((item) => item.id === source)?.name ?? source;
  const importable = catalog?.events.filter((event) => !eventAlreadyPresent(event, target)) ?? [];
  const chosen = importable.filter((event) => selected.has(event.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const run = async () => {
    if (!catalog || !chosen.length || progress) return;
    const plan = planCatalogImport(catalog, target, chosen.map((event) => event.id));
    const reason = `Imported from ${sourceName}`.slice(0, 500);
    const total = plan.categories.length + plan.events.length;
    let done = 0;
    setError("");
    setProgress(`Importing… 0 of ${total}`);
    try {
      for (const category of plan.categories) {
        await execute({ type: "saveCategory", category, reason });
        setProgress(`Importing… ${++done} of ${total}`);
      }
      for (const event of plan.events) {
        await execute({ type: "saveEvent", event, reason });
        setProgress(`Importing… ${++done} of ${total}`);
      }
      setProgress("");
      onDone();
    } catch (reason) {
      setProgress("");
      setError(
        `${reason instanceof Error ? reason.message : "Could not import every event."} ${done} of ${total} saved; importing again skips those.`,
      );
    }
  };
  if (!others.length)
    return <p className="empty">There are no other conferences to import events from.</p>;
  const busy = Boolean(progress);
  return (
    <section className="admin-import" aria-label="Import events">
      <div className="admin-field">
        <label htmlFor="admin-import-source">Import events from</label>
        <ThemedSelect
          id="admin-import-source"
          label="Import events from"
          value={source}
          onChange={setPicked}
          options={others.map((item) => ({ value: item.id, label: `${item.name} (${item.status})` }))}
        />
      </div>
      <p className="muted">
        Scoring, units and instructions are copied. Events this conference already has (same name) are skipped.
      </p>
      {loadError ? (
        <p className="form-message">{loadError}</p>
      ) : !catalog ? (
        <p className="muted">Loading events…</p>
      ) : (
        <fieldset className="event-picker" disabled={busy}>
          <div className="form-actions">
            <Button type="button" className="compact" onClick={() => setSelected(new Set(importable.map((event) => event.id)))}>
              Select all
            </Button>
            <Button type="button" className="compact" onClick={() => setSelected(new Set())}>
              Select none
            </Button>
            <span className="muted">
              {chosen.length} of {importable.length} new events
            </span>
          </div>
          {catalog.categories.map((category) => {
            const inCategory = catalog.events.filter((event) => event.categoryId === category.id);
            if (!inCategory.length) return null;
            return (
              <fieldset key={category.id} className="admin-event-group">
                <legend>{category.name}</legend>
                {inCategory.map((event) => {
                  const present = eventAlreadyPresent(event, target);
                  return (
                    <label key={event.id} className={`check${present ? " muted" : ""}`}>
                      <input
                        type="checkbox"
                        disabled={present}
                        checked={present || selected.has(event.id)}
                        onChange={() => toggle(event.id)}
                      />
                      {event.name}
                      {present ? (
                        <small className="muted"> (already here)</small>
                      ) : (
                        !event.active && <small className="muted"> (inactive)</small>
                      )}
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
        </fieldset>
      )}
      <div className="form-actions">
        <Button type="button" className="primary" disabled={busy || !chosen.length} onClick={() => void run()}>
          <Download aria-hidden="true" />{" "}
          {progress || `Import ${chosen.length} ${chosen.length === 1 ? "event" : "events"}`}
        </Button>
        <Button type="button" disabled={busy} onClick={onDone}>Cancel</Button>
      </div>
      {error && <p className="form-message" role="alert">{error}</p>}
    </section>
  );
}

const KIND_ICONS: Record<Competition["kind"], LucideIcon> = {
  count: Hash,
  duration: Timer,
  distance: Ruler,
  bracket: Swords,
  knockout: Trophy,
};

const scored = (kind: Competition["kind"]) => kind !== "bracket" && kind !== "knockout";

/** One readable line: how the event is scored and who plays it. */
function eventSummary(event: Competition) {
  const parts: string[] = [KIND_LABELS[event.kind]];
  if (scored(event.kind)) {
    if (event.unit.trim()) parts.push(event.unit.trim());
    parts.push(event.direction === "higher" ? "Higher wins" : "Lower wins");
  }
  if (event.team) parts.push(event.teamSize > 1 ? `Teams of ${event.teamSize}` : "Teams");
  return parts.join(" · ");
}

/** Create or edit form for one event, shown inline where the admin opened it. */
function EventForm({
  snapshot,
  execute,
  initial,
  creating,
  onDone,
}: {
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
  initial: Competition;
  creating: boolean;
  onDone: (saved?: Competition) => void;
}) {
  const [draft, setDraft] = useState<Competition>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof Competition>(key: K, value: Competition[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const id = `event-${initial.id}`;
  const categories = [...snapshot.data.categories].sort((a, b) => a.order - b.order);
  const save = async () => {
    if (saving || !draft.name.trim() || !draft.categoryId) return;
    setSaving(true);
    setError("");
    const event = {
      ...draft,
      name: draft.name.trim(),
      teamSize: draft.team ? Math.max(0, Number(draft.teamSize)) : 1,
    };
    try {
      await execute({ type: "saveEvent", event, reason: "Administrator event update" });
      onDone(event);
    } catch {
      setError("Could not save the event.");
      setSaving(false);
    }
  };
  return (
    <form
      className="event-form"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <div className="admin-grid">
        <label className="wide">
          Name
          <input
            value={draft.name}
            autoFocus={creating}
            placeholder="e.g. Push-ups in 60 seconds"
            onChange={(e) => update("name", e.target.value)}
          />
        </label>
        <div className="admin-field">
          <label htmlFor={`${id}-category`}>Category</label>
          <ThemedSelect
            id={`${id}-category`}
            label="Category"
            value={draft.categoryId}
            onChange={(value) => update("categoryId", value)}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`${id}-scoring`}>Scoring</label>
          <ThemedSelect
            id={`${id}-scoring`}
            label="Scoring"
            value={draft.kind}
            onChange={(value) => update("kind", value as Competition["kind"])}
            options={(Object.keys(KIND_LABELS) as Competition["kind"][]).map((kind) => ({
              value: kind,
              label: KIND_LABELS[kind],
            }))}
          />
        </div>
        {scored(draft.kind) && (
          <>
            <div className="admin-field">
              <label htmlFor={`${id}-direction`}>Winner</label>
              <ThemedSelect
                id={`${id}-direction`}
                label="Winner"
                value={draft.direction}
                onChange={(value) => update("direction", value as Competition["direction"])}
                options={[
                  { value: "higher", label: "Higher wins" },
                  { value: "lower", label: "Lower wins" },
                ]}
              />
            </div>
            <label>
              Unit
              <input
                value={draft.unit}
                placeholder="reps, seconds, feet…"
                onChange={(e) => update("unit", e.target.value)}
              />
            </label>
          </>
        )}
        <div className="event-form-checks wide">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.team}
              onChange={(e) => {
                const team = e.target.checked;
                setDraft((d) => ({ ...d, team, teamSize: team && d.teamSize < 2 ? 2 : d.teamSize }));
              }}
            />
            Team event
          </label>
          {draft.team && (
            <label className="event-team-size">
              Players per team
              <input
                type="number"
                min="0"
                value={draft.teamSize}
                onChange={(e) => update("teamSize", Number(e.target.value))}
              />
            </label>
          )}
          {creating && (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => update("active", e.target.checked)}
              />
              Active (visible to competitors)
            </label>
          )}
        </div>
        <label className="wide">
          Instructions
          <textarea
            value={draft.instructions}
            placeholder="How the event is run and judged"
            onChange={(e) => update("instructions", e.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <Button type="submit" className="primary" disabled={saving || !draft.name.trim() || !draft.categoryId}>
          {saving ? "Saving…" : creating ? "Create event" : "Save changes"}
        </Button>
        <Button type="button" disabled={saving} onClick={() => onDone()}>Cancel</Button>
      </div>
      {error && <p className="form-message" role="alert">{error}</p>}
    </form>
  );
}

type EventFilter = "all" | "active" | "inactive";

function AdminEvents({
  snapshot,
  execute,
}: {
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
}) {
  const link = useConferenceLink();
  const [creating, setCreating] = useState<Competition | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EventFilter>("all");
  const [toggling, setToggling] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [toggleError, setToggleError] = useState("");
  const all = snapshot.data.events;
  const activeCount = all.filter((e) => e.active).length;
  const counts: Record<EventFilter, number> = {
    all: all.length,
    active: activeCount,
    inactive: all.length - activeCount,
  };
  const startCreate = () => {
    setEditingId(undefined);
    setImporting(false);
    setMessage("");
    setCreating({
      id: nowId(),
      categoryId: [...snapshot.data.categories].sort((a, b) => a.order - b.order)[0]?.id ?? "",
      name: "",
      kind: "count",
      direction: "higher",
      unit: "reps",
      team: false,
      teamSize: 1,
      instructions: "",
      active: true,
    });
  };
  const toggleActive = async (event: Competition) => {
    if (toggling) return;
    setToggling(event.id);
    setToggleError("");
    try {
      await execute({
        type: "saveEvent",
        event: { ...event, active: !event.active },
        reason: "Administrator event update",
      });
    } catch {
      setToggleError(`Could not change ${event.name}. Try again.`);
    } finally {
      setToggling(undefined);
    }
  };
  const needle = query.trim().toLowerCase();
  const visible = all
    .filter((e) => filter === "all" || (filter === "active") === e.active)
    .filter((e) => !needle || e.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = [...snapshot.data.categories]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, name: c.name, events: visible.filter((e) => e.categoryId === c.id) }));
  const orphans = visible.filter((e) => !snapshot.data.categories.some((c) => c.id === e.categoryId));
  if (orphans.length) groups.push({ id: "uncategorized", name: "Uncategorized", events: orphans });
  return (
    <>
      <div className="admin-section-head events-head">
        <div>
          <h1>EVENTS</h1>
          <p className="muted">
            {counts.all} {counts.all === 1 ? "event" : "events"} · {counts.active} active
          </p>
        </div>
        <div className="form-actions">
          <Button type="button" className="compact" onClick={() => { setCreating(undefined); setImporting(true); }}>
            <Download aria-hidden="true" /> Import
          </Button>
          <Button type="button" className="compact primary" onClick={startCreate}>
            <Plus aria-hidden="true" /> New event
          </Button>
        </div>
      </div>
      {importing && (
        <ImportEvents snapshot={snapshot} execute={execute} onDone={() => setImporting(false)} />
      )}
      {creating && (
        <section className="event-create" aria-label="New event">
          <h2>NEW EVENT</h2>
          <EventForm
            key={creating.id}
            snapshot={snapshot}
            execute={execute}
            initial={creating}
            creating
            onDone={(saved) => {
              setCreating(undefined);
              if (saved) setMessage(`${saved.name} created.`);
            }}
          />
        </section>
      )}
      {message && <p className="form-message saved events-message" role="status">{message}</p>}
      {toggleError && <p className="form-message events-message" role="alert">{toggleError}</p>}
      {all.length > 0 && (
        <div className="events-toolbar">
          <label className="events-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find an event"
              aria-label="Find an event"
            />
          </label>
          <div className="segmented" role="group" aria-label="Show">
            {(["all", "active", "inactive"] as EventFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value} <span>{counts[value]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {visible.length === 0 ? (
        <p className="empty">
          {all.length === 0
            ? "No events yet. Create one or import them from another conference."
            : needle
              ? `No events match “${query.trim()}”.`
              : `No ${filter} events.`}
        </p>
      ) : (
        groups
          .filter((g) => g.events.length)
          .map((group) => (
            <section key={group.id} className="admin-event-group" aria-labelledby={`group-${group.id}`}>
              <h3 id={`group-${group.id}`}>
                {group.name} <span>{group.events.length}</span>
              </h3>
              <div className="admin-list">
                {group.events.map((e) => {
                  const Icon = KIND_ICONS[e.kind];
                  const open = editingId === e.id;
                  return (
                    <article
                      key={e.id}
                      className={`admin-row admin-event${e.active ? "" : " inactive"}${open ? " editing" : ""}`}
                    >
                      <div className="admin-row-head">
                        <span className="event-kind" title={KIND_LABELS[e.kind]}>
                          <Icon aria-hidden="true" />
                        </span>
                        <div className="admin-row-main">
                          <strong>{e.name}</strong>
                          <small>{eventSummary(e)}</small>
                        </div>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            role="switch"
                            className="event-switch"
                            aria-checked={e.active}
                            aria-label={`${e.name} active`}
                            disabled={toggling === e.id}
                            onClick={() => void toggleActive(e)}
                          >
                            <span className="track" aria-hidden="true"><span /></span>
                            {e.active ? "Active" : "Off"}
                          </button>
                          {!scored(e.kind) && (
                            <Link className="button compact event-manage" to={link(`/events/${e.id}`)}>
                              {e.kind === "knockout" ? <Trophy aria-hidden="true" /> : <Swords aria-hidden="true" />}
                              {e.kind === "knockout" ? "Game" : "Bracket"}
                            </Link>
                          )}
                          <Button
                            type="button"
                            className={`compact event-edit${open ? " active" : ""}`}
                            aria-expanded={open}
                            onClick={() => {
                              setCreating(undefined);
                              setMessage("");
                              setEditingId(open ? undefined : e.id);
                            }}
                          >
                            {open ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                            {open ? "Close" : "Edit"}
                          </Button>
                        </div>
                      </div>
                      {open && (
                        <div className="admin-row-panel">
                          <EventForm
                            snapshot={snapshot}
                            execute={execute}
                            initial={e}
                            creating={false}
                            onDone={() => setEditingId(undefined)}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
      )}
    </>
  );
}
/** Conference details for its admins; status and admins for organizers. */
function AdminConference({ snapshot }: { snapshot: AppSnapshot }) {
  const { store } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const conference = snapshot.conference;
  if (!conference) return null;
  const organizer = Boolean(snapshot.identity?.organizer);
  const archived = conference.status === "archived";
  const next = statusAction(conference.status);
  const changeStatus = async () => {
    if (next.to === "archived" && !window.confirm(`Archive ${conference.name}? Its results become read-only.`)) return;
    setBusy(true);
    setMessage("");
    try {
      await store.updateConference(conference.id, { status: next.to });
      setMessage(`${conference.name} is now ${next.to}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change the status.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>CONFERENCE</h1>
      <p className="conference-status-line">
        <em className={`status-badge ${conference.status}`}>{conference.status}</em>
        <span className="muted">/c/{conference.id}</span>
      </p>
      {organizer ? (
        <div className="form-actions">
          <Button type="button" disabled={busy} onClick={() => void changeStatus()}>
            {next.label}
          </Button>
          <Link className="button" to={withDemo("/organizer")}>
            <Building2 aria-hidden="true" /> Organizer area
          </Link>
        </div>
      ) : (
        <p className="muted">Only organizers can publish, archive or unarchive a conference.</p>
      )}
      {message && <p className="form-message" role="status">{message}</p>}
      <h2>DETAILS</h2>
      {archived && !organizer && (
        <p className="muted">This conference is archived, so its details are read-only.</p>
      )}
      <ConferenceDetailsForm key={conference.id} conference={conference} disabled={archived && !organizer} />
      <h2>ADMINS</h2>
      <ConferenceAdmins conference={conference} canManage={organizer} />
    </>
  );
}

export function Admin() {
  const link = useConferenceLink();
  const { snapshot, execute, signInAdmin, signOutAdmin } = useConference();
  const [tab, setTab] = useState<
    "results" | "participants" | "events" | "conference" | "audit"
  >("results");
  const [selected, setSelected] = useState<Attempt | undefined>();
  const [value, setValue] = useState("");
  const [valid, setValid] = useState(true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [adminError, setAdminError] = useState("");
  const previousTab = useRef(tab);
  useLayoutEffect(() => {
    if (previousTab.current !== tab) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      previousTab.current = tab;
    }
  }, [tab]);
  if (!snapshot.identity?.admin)
    return (
      <PageShell lockWhenArchived={false}>
        <section className="admin-login">
          <ShieldCheck />
          <h1>ADMIN ACCESS</h1>
          <p>
            Sign in with an authorized Google account to manage the competition.
          </p>
          <Button type="button" className="primary" onClick={signInAdmin}>
            {snapshot.mode === "demo"
              ? "Enter demo admin"
              : "Sign in with Google"}
          </Button>
          {snapshot.mode === "demo" && (
            <small>
              Demo mode uses sample data and an administrator session.
            </small>
          )}
        </section>
      </PageShell>
    );
  const correction = async () => {
    if (saving) return;
    const event =
      selected &&
      snapshot.data.events.find((item) => item.id === selected.eventId);
    const parsed = Number(value);
    const invalid =
      !selected ||
      !reason.trim() ||
      !value.trim() ||
      !event ||
      !Number.isFinite(parsed) ||
      (event.kind === "count" && (!Number.isInteger(parsed) || parsed < 0)) ||
      (event.kind !== "count" && parsed <= 0);
    if (invalid) {
      setAdminError("Enter a valid corrected result and a reason.");
      return;
    }
    setSaving(true);
    setAdminError("");
    try {
      await execute({
        type: "correctAttempt",
        id: selected.id,
        value: parsed,
        valid,
        reason,
        revision: selected.revision,
      });
      setSelected(undefined);
      setReason("");
    } catch {
      setAdminError(
        "Unable to save this correction. Reselect the latest attempt and try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <PageShell lockWhenArchived={false}>
      <section className="admin">
        <aside>
          <h2>ADMIN</h2>
          {(
            [
              "results",
              "participants",
              "events",
              "conference",
              "audit",
            ] as const
          ).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t === "results" ? (
                <FileText />
              ) : t === "participants" ? (
                <Users />
              ) : t === "events" ? (
                <CalendarDays />
              ) : t === "conference" ? (
                <Settings />
              ) : (
                <Clock3 />
              )}
              {t}
            </button>
          ))}
          <Link className="button" to={link("/admin/signs")}>
            <QrCode /> Event signs
          </Link>
          {snapshot.identity.organizer && (
            <Link className="button" to={withDemo("/organizer")}>
              <Building2 /> Organizer
            </Link>
          )}
          <Button type="button" onClick={signOutAdmin}>Sign out</Button>
        </aside>
        <div className="admin-main">
          {tab === "results" && (
            <>
              <h1>CORRECT RESULT</h1>
              <form onSubmit={(event) => { event.preventDefault(); void correction(); }}>
                <div className="admin-grid">
                <div className="admin-field wide">
                  <label htmlFor="admin-attempt">Attempt</label>
                  <ThemedSelect
                    id="admin-attempt"
                    label="Attempt"
                    value={selected?.id ?? ""}
                    onChange={(value) => {
                      const a = snapshot.data.attempts.find(
                        (x) => x.id === value,
                      );
                      setSelected(a);
                      setValue(a ? String(a.value) : "");
                      setValid(a?.valid ?? true);
                    }}
                    options={[
                      { value: "", label: "Select an attempt" },
                      ...snapshot.data.attempts.map((a) => ({
                        value: a.id,
                        label: `${snapshot.data.events.find((x) => x.id === a.eventId)?.name}: ${snapshot.data.participants.find((p) => p.id === a.participantId)?.name}, ${(() => {
                          const event = snapshot.data.events.find(
                            (x) => x.id === a.eventId,
                          );
                          return event ? formatScore(a.value, event) : a.value;
                        })()} (${new Date(a.createdAt).toLocaleString()})`,
                      })),
                    ]}
                  />
                </div>
                {selected && (
                  <>
                    <label>
                      Original result
                      <input
                        readOnly
                        value={formatScore(
                          selected.value,
                          snapshot.data.events.find(
                            (e) => e.id === selected.eventId,
                          )!,
                        )}
                      />
                    </label>
                    <label>
                      Corrected result
                      <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </label>
                    <label className="check wide">
                      <input
                        type="checkbox"
                        checked={valid}
                        onChange={(e) => setValid(e.target.checked)}
                      />
                      Valid result (uncheck to invalidate)
                    </label>
                    <label className="wide">
                      Reason for correction
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Explain why this result needs correction or invalidation"
                      />
                    </label>
                  </>
                )}
                </div>
                <Button
                  type="submit"
                  className="primary"
                  disabled={!selected || !reason || saving}
                >
                  {saving
                    ? "Saving…"
                    : valid
                      ? "Save correction"
                      : "Invalidate attempt"}
                </Button>
              </form>
              {adminError && <p className="form-message">{adminError}</p>}
              <h2>AUDIT HISTORY</h2>
              <Audit items={snapshot.data.audit.slice(0, 5)} />
            </>
          )}
          {tab === "participants" && (
            <AdminParticipants
              snapshot={snapshot}
              execute={execute}
              onCorrect={(attempt) => {
                setSelected(attempt);
                setValue(String(attempt.value));
                setValid(attempt.valid);
                setReason("");
                setAdminError("");
                setTab("results");
              }}
            />
          )}
          {tab === "events" && (
            <AdminEvents snapshot={snapshot} execute={execute} />
          )}
          {tab === "conference" && <AdminConference snapshot={snapshot} />}
          {tab === "audit" && (
            <>
              <h1>AUDIT HISTORY</h1>
              <Audit items={snapshot.data.audit} />
            </>
          )}
        </div>
      </section>
    </PageShell>
  );
}
