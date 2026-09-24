import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { normalizeName } from "@/domain/ranking";
import type { Identity, Participant } from "@/domain/types";
import { Button, PageShell, withDemo } from "./shared";
import "./EntryForms.css";

export function safeReturnPath(next: string | null) {
  return next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/welcome") &&
    !next.includes("\\")
    ? next
    : "/events";
}

export function resolveIdentityParticipantId(
  name: string,
  identity: Identity | null | undefined,
  currentParticipantId: string | undefined,
  participants: Participant[],
) {
  if (currentParticipantId) return currentParticipantId;
  const normalized = normalizeName(name);
  if (identity?.participantId && normalized === normalizeName(identity.name))
    return identity.participantId;
  return participants.find((participant) => normalizeName(participant.name) === normalized)?.id;
}

export function Welcome() {
  const { snapshot, execute } = useConference();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState(snapshot.identity?.name ?? "");
  const [selected, setSelected] = useState<Participant | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const initializedFromIdentity = useRef(false);
  const hasIdentity = Boolean(snapshot.identity?.name.trim());
  useEffect(() => {
    if (!initializedFromIdentity.current && snapshot.identity?.name) {
      setName(snapshot.identity.name);
      initializedFromIdentity.current = true;
    }
  }, [snapshot.identity?.name]);
  const matches = useMemo(
    () =>
      snapshot.data.participants
        .filter((p) => normalizeName(p.name).includes(normalizeName(name)))
        .slice(0, 5),
    [name, snapshot.data.participants],
  );
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const participantId = resolveIdentityParticipantId(
        name,
        snapshot.identity,
        selected?.id,
        snapshot.data.participants,
      );
      await execute({
        type: "identity",
        name: name.trim(),
        participantId,
      });
      const next = new URLSearchParams(location.search).get("next");
      navigate(withDemo(safeReturnPath(next)));
    } catch {
      setError("Could not save your name. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <PageShell>
      <form
        className="welcome"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="eyebrow">{hasIdentity ? "Profile" : "First visit"}</div>
        <h1>{hasIdentity ? "CHANGE YOUR NAME" : "WHAT’S YOUR NAME?"}</h1>
        <p>
          {hasIdentity
            ? "We’ll remember this name on your browser and use it when you record results."
            : "We’ll remember you on this browser."}
        </p>
        <div className="entry-field welcome-name-field">
          <label htmlFor="welcome-name">Your name</label>
          <input
            id="welcome-name"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSelected(undefined);
            }}
            placeholder="Enter your name"
          />
        </div>
        {name.trim() && matches.length > 0 && (
          <div className="suggestions">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setName(p.name);
                  setSelected(p);
                }}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>Existing participant</small>
                </span>
                {selected?.id === p.id && <Check />}
              </button>
            ))}
          </div>
        )}
        <Button
          className="primary"
          type="submit"
          disabled={!name.trim() || saving}
        >
          {saving ? "Saving…" : hasIdentity ? "Save name" : `Continue${name ? ` as ${name}` : ""}`}
        </Button>
        {hasIdentity && (
          <Button
            className="secondary"
            type="button"
            disabled={saving}
            onClick={() => {
              const next = new URLSearchParams(location.search).get("next");
              navigate(withDemo(safeReturnPath(next)));
            }}
          >
            Cancel
          </Button>
        )}
        {error && <p className="form-message" role="alert">{error}</p>}
        <p className="muted rule">
          You can record results for yourself or someone else.
        </p>
      </form>
    </PageShell>
  );
}
