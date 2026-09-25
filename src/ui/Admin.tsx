import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Clock3,
  FileText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { formatScore } from "@/domain/ranking";
import type {
  AppSnapshot,
  Attempt,
  Competition,
  ConferenceStore,
} from "@/domain/types";
import { Audit, Button, PageShell, nowId, withDemo } from "./shared";
import { ThemedSelect } from "./ThemedSelect";

function AdminParticipants({
  snapshot,
  execute,
}: {
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
}) {
  const [newParticipantName, setNewParticipantName] = useState("");
  const [participantSaving, setParticipantSaving] = useState(false);
  const [participantError, setParticipantError] = useState("");
  const [participantSuccess, setParticipantSuccess] = useState("");
  const [rename, setRename] = useState("");
  const [id, setId] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving || !id || !rename.trim()) return;
    setSaving(true);
    try {
      await execute({
        type: "renameParticipant",
        id,
        name: rename.trim(),
        reason: "Administrator rename",
      });
    } finally {
      setSaving(false);
    }
  };
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
  return (
    <>
      <h1>PARTICIPANTS</h1>
      <h2>ADD PARTICIPANT</h2>
      <p>Add someone here so they can be selected for teams and brackets.</p>
      <form onSubmit={(event) => { event.preventDefault(); void addParticipant(); }}>
        <div className="admin-grid">
          <label>
            Participant name
            <input
              value={newParticipantName}
              onChange={(event) => setNewParticipantName(event.target.value)}
              placeholder="Full name"
            />
          </label>
        </div>
        <Button
          type="submit"
          className="primary"
          disabled={participantSaving || !newParticipantName.trim()}
        >
          {participantSaving ? "Adding…" : "Add participant"}
        </Button>
      </form>
      {participantError && <p className="form-message">{participantError}</p>}
      {participantSuccess && <p className="form-message">{participantSuccess}</p>}
      <h2>RENAME PARTICIPANT</h2>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="admin-grid">
        <div className="admin-field">
          <label htmlFor="admin-participant">Participant</label>
          <ThemedSelect
            id="admin-participant"
            label="Participant"
            value={id}
            onChange={(value) => {
              setId(value);
              setRename(
                snapshot.data.participants.find((p) => p.id === value)
                  ?.name ?? "",
              );
            }}
            options={[
              { value: "", label: "Select participant" },
              ...snapshot.data.participants.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
          />
        </div>
        <label>
          New name
          <input value={rename} onChange={(e) => setRename(e.target.value)} />
        </label>
        </div>
        <Button
          type="submit"
        className="primary"
          disabled={saving || !id || !rename.trim()}
        >
          {saving ? "Saving…" : "Save name"}
        </Button>
      </form>
    </>
  );
}
function AdminEvents({
  snapshot,
  execute,
}: {
  snapshot: AppSnapshot;
  execute: ConferenceStore["execute"];
}) {
  const blank = (): Competition => ({
    id: nowId(),
    categoryId: snapshot.data.categories[0]?.id ?? "",
    name: "",
    kind: "count",
    direction: "higher",
    unit: "reps",
    team: false,
    teamSize: 1,
    instructions: "",
    active: true,
  });
  const [draft, setDraft] = useState<Competition>(blank);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof Competition>(key: K, value: Competition[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const save = async () => {
    if (saving || !draft.name.trim() || !draft.categoryId) return;
    setSaving(true);
    setError("");
    try {
      await execute({
        type: "saveEvent",
        event: {
          ...draft,
          name: draft.name.trim(),
          teamSize: draft.team ? Math.max(0, Number(draft.teamSize)) : 1,
        },
        reason: "Administrator event update",
      });
      setDraft(blank());
    } catch {
      setError("Could not save the event.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <h1>EVENT EDITOR</h1>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="admin-grid">
        <label>
          Name
          <input
            value={draft.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </label>
        <div className="admin-field">
          <label htmlFor="admin-event-scoring">Scoring</label>
          <ThemedSelect
            id="admin-event-scoring"
            label="Scoring"
            value={draft.kind}
            onChange={(value) =>
              update("kind", value as Competition["kind"])
            }
            options={[
              { value: "count", label: "Count" },
              { value: "duration", label: "Duration" },
              { value: "distance", label: "Distance" },
              { value: "bracket", label: "Bracket" },
            ]}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="admin-event-direction">Direction</label>
          <ThemedSelect
            id="admin-event-direction"
            label="Direction"
            value={draft.direction}
            onChange={(value) =>
              update("direction", value as Competition["direction"])
            }
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
            onChange={(e) => update("unit", e.target.value)}
          />
        </label>
        <label>
          Team size
          <input
            type="number"
            min="0"
            value={draft.teamSize}
            onChange={(e) => update("teamSize", Number(e.target.value))}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.team}
            onChange={(e) => update("team", e.target.checked)}
          />
          Team event
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => update("active", e.target.checked)}
          />
          Active
        </label>
        <label className="wide">
          Instructions
          <textarea
            value={draft.instructions}
            onChange={(e) => update("instructions", e.target.value)}
          />
        </label>
        </div>
        <Button type="submit" className="primary" disabled={saving || !draft.name.trim() || !draft.categoryId}>
        {snapshot.data.events.some((e) => e.id === draft.id)
          ? "Save event"
          : "Create event"}
        </Button>
      </form>
      {error && <p className="form-message">{error}</p>}
      <div className="edit-list">
        {snapshot.data.events.map((e) => (
          <article key={e.id}>
            <div>
              <strong>{e.name}</strong>
              <small>
                {e.active ? "Active" : "Inactive"} · {e.kind}
              </small>
            </div>
            {e.kind === "bracket" && (
              <Link to={withDemo(`/events/${e.id}`)}>
                {e.team ? "Manage teams & bracket" : "Manage participants & bracket"}
              </Link>
            )}
            <Button type="button" onClick={() => setDraft(e)}>Edit</Button>
          </article>
        ))}
      </div>
    </>
  );
}
export function Admin() {
  const { snapshot, execute, signInAdmin, signOutAdmin } = useConference();
  const [tab, setTab] = useState<
    "results" | "participants" | "events" | "audit"
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
      <PageShell>
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
    <PageShell>
      <section className="admin">
        <aside>
          <h2>ADMIN</h2>
          {(
            [
              "results",
              "participants",
              "events",
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
              ) : (
                <Clock3 />
              )}
              {t}
            </button>
          ))}
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
            <AdminParticipants snapshot={snapshot} execute={execute} />
          )}
          {tab === "events" && (
            <AdminEvents snapshot={snapshot} execute={execute} />
          )}
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
