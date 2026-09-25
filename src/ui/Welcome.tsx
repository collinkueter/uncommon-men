import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { normalizeName } from "@/domain/ranking";
import { findSimilarParticipants } from "@/domain/nameMatch";
import type { ConferenceState, Participant } from "@/domain/types";
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

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function timeAgo(at: number, now: number) {
  const minutes = Math.round((at - now) / 60000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

// What the roster already knows about someone, so a person can recognize the
// record a teammate made for them: the teams they are on and the last result
// logged for them or their team.
export function participantDetails(
  participant: Participant,
  data: ConferenceState,
  now = Date.now(),
): { teams: string | null; activity: string } {
  const teams = data.teams.filter((team) => team.memberIds.includes(participant.id));
  const eventName = (id: string) => data.events.find((event) => event.id === id)?.name;
  // Teams often keep one name across events: "Iron Brothers (Cornhole, Foosball)".
  const eventsByTeamName = new Map<string, string[]>();
  for (const team of teams) {
    const events = eventsByTeamName.get(team.name) ?? [];
    const event = eventName(team.eventId);
    if (event) events.push(event);
    eventsByTeamName.set(team.name, events);
  }
  const teamLabels = [...eventsByTeamName].map(([name, events]) =>
    events.length ? `${name} (${events.join(", ")})` : name,
  );
  const competitorIds = new Set([participant.id, ...teams.map((team) => team.id)]);
  const results = data.attempts.filter(
    (attempt) => attempt.valid && competitorIds.has(attempt.participantId),
  );
  const latest = results.reduce<(typeof results)[number] | undefined>(
    (best, attempt) => (!best || attempt.createdAt > best.createdAt ? attempt : best),
    undefined,
  );
  const latestEvent = latest && eventName(latest.eventId);
  return {
    teams: teamLabels.length
      ? `${teamLabels.length === 1 ? "Team" : "Teams"}: ${teamLabels.slice(0, 2).join(", ")}${teamLabels.length > 2 ? ` +${teamLabels.length - 2} more` : ""}`
      : null,
    activity: latest
      ? `Last logged ${latestEvent ?? "a result"} ${timeAgo(latest.createdAt, now)}${results.length > 1 ? ` · ${results.length} results` : ""}`
      : teams.length
        ? "No results logged yet"
        : "Added to the roster, no results yet",
  };
}

function ParticipantOption({
  participant,
  data,
  selected,
  action,
  onPick,
  disabled,
}: {
  participant: Participant;
  data: ConferenceState;
  selected?: boolean;
  action?: string;
  onPick: () => void;
  disabled?: boolean;
}) {
  const details = participantDetails(participant, data);
  return (
    <button
      type="button"
      className={`participant-option${selected ? " selected" : ""}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
    >
      <span className="participant-option-text">
        <strong>{participant.name}</strong>
        {details.teams && <small>{details.teams}</small>}
        <small className="participant-option-activity">{details.activity}</small>
      </span>
      {selected ? <Check aria-hidden="true" /> : action && <span className="claim-cta">{action}</span>}
    </button>
  );
}

export function Welcome() {
  const { snapshot, execute, signInWithGoogle, signOutAdmin } = useConference();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState(snapshot.identity?.name ?? "");
  const [selected, setSelected] = useState<Participant | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [googlePending, setGooglePending] = useState(false);
  // Set when the typed name resembles people already on the roster, most
  // often because a teammate added this person to a team before they
  // opened the app. Picking one connects this device to that record.
  const [confirming, setConfirming] = useState<{ name: string; candidates: Participant[] } | null>(null);
  const initializedFromIdentity = useRef(false);
  const hasIdentity = Boolean(snapshot.identity?.name.trim());
  useEffect(() => {
    if (!initializedFromIdentity.current && snapshot.identity?.name) {
      setName(snapshot.identity.name);
      initializedFromIdentity.current = true;
    }
  }, [snapshot.identity?.name]);
  const matches = useMemo(() => {
    const query = normalizeName(name);
    if (!query) return [];
    const similar = findSimilarParticipants(name, snapshot.data.participants);
    const partial = snapshot.data.participants.filter(
      (p) => !similar.includes(p) && normalizeName(p.name).includes(query),
    );
    return [...similar, ...partial].slice(0, 5);
  }, [name, snapshot.data.participants]);
  const returnToNext = () => {
    const next = new URLSearchParams(location.search).get("next");
    navigate(withDemo(safeReturnPath(next)));
  };
  // Google sign-in can switch to a different account; wait until that
  // account's profile has loaded before leaving this screen.
  useEffect(() => {
    const identity = snapshot.identity;
    if (!googlePending || !identity?.email || !identity.name.trim()) return;
    setGooglePending(false);
    const candidates = identity.participantId
      ? []
      : findSimilarParticipants(identity.name, snapshot.data.participants);
    if (candidates.length) setConfirming({ name: identity.name, candidates });
    else returnToNext();
  }, [googlePending, snapshot.identity?.email, snapshot.identity?.name]);
  useEffect(() => {
    if (!googlePending) return;
    const timer = window.setTimeout(() => {
      setGooglePending(false);
      setError("Signed in. Enter your name above to finish.");
    }, 8000);
    return () => clearTimeout(timer);
  }, [googlePending]);
  const google = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await signInWithGoogle(name);
      setGooglePending(true);
    } catch (reason) {
      const code = (reason as { code?: string })?.code ?? "";
      if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"].includes(code))
        setError(
          code === "app/google-account-in-use"
            ? "That Google account is already set up. Tap Continue with Google again to sign in to it."
            : code === "auth/popup-blocked"
              ? "Your browser blocked the Google window. Allow pop-ups, or just enter your name above."
              : "Google sign-in didn’t work. You can just enter your name above instead.",
        );
    } finally {
      setSaving(false);
    }
  };
  const commit = async (displayName: string, participantId: string | undefined) => {
    setSaving(true);
    setError("");
    try {
      await execute({ type: "identity", name: displayName, participantId });
      returnToNext();
    } catch {
      setError("Could not save your name. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    if (selected) return commit(selected.name, selected.id);
    const linked = snapshot.identity?.participantId;
    if (linked && normalizeName(trimmed) === normalizeName(snapshot.identity!.name))
      return commit(trimmed, linked);
    const candidates = findSimilarParticipants(trimmed, snapshot.data.participants);
    if (candidates.length) {
      setError("");
      setConfirming({ name: trimmed, candidates });
      return;
    }
    return commit(trimmed, undefined);
  };
  // Results are matched by name, so a second person with exactly the same
  // name would share a record. Ask for something that tells them apart.
  const notMe = () => {
    if (!confirming) return;
    const normalized = normalizeName(confirming.name);
    if (confirming.candidates.some((participant) => normalizeName(participant.name) === normalized)) {
      setName(confirming.name);
      setConfirming(null);
      setError(`Someone named ${confirming.name} is already on the roster. Add a last name, middle initial or nickname so your results stay separate.`);
      return;
    }
    void commit(confirming.name, undefined);
  };
  if (confirming)
    return (
      <PageShell>
        <div className="welcome">
          <h1>IS ONE OF THESE YOU?</h1>
          <p>
            A teammate may have already added you to a team or entered a result for you.
            Pick your name to keep it all together.
          </p>
          <div className="participant-options claim-list">
            {confirming.candidates.map((participant) => (
              <ParticipantOption
                key={participant.id}
                participant={participant}
                data={snapshot.data}
                action="That’s me"
                disabled={saving}
                onPick={() => void commit(participant.name, participant.id)}
              />
            ))}
          </div>
          <Button className="secondary" type="button" disabled={saving} onClick={notMe}>
            {saving ? "Saving…" : `None of these, continue as ${confirming.name}`}
          </Button>
          <button
            type="button"
            className="underline claim-back"
            disabled={saving}
            onClick={() => {
              setName(confirming.name);
              setConfirming(null);
            }}
          >
            Change the name I typed
          </button>
          {error && <p className="form-message" role="alert">{error}</p>}
        </div>
      </PageShell>
    );
  return (
    <PageShell>
      <form
        className="welcome"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
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
          <div className="participant-options" aria-label="People already on the roster">
            <p className="participant-options-hint">Already on the roster? Tap your name.</p>
            {matches.map((p) => (
              <ParticipantOption
                key={p.id}
                participant={p}
                data={snapshot.data}
                selected={selected?.id === p.id}
                onPick={() => {
                  setName(p.name);
                  setSelected(p);
                }}
              />
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
        {snapshot.identity?.email ? (
          <div className="google-status">
            <span>
              Signed in with Google
              <small>{snapshot.identity.email}</small>
            </span>
            <button
              type="button"
              className="underline"
              disabled={saving}
              onClick={() => void signOutAdmin()}
            >
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div className="auth-divider" role="presentation">
              <span>or</span>
            </div>
            <Button
              className="secondary google-button"
              type="button"
              disabled={saving || googlePending}
              onClick={() => void google()}
            >
              <GoogleMark />
              {googlePending ? "Signing in…" : "Continue with Google"}
            </Button>
            <p className="muted google-note">
              Use Google to keep your results across devices.
            </p>
          </>
        )}
        <p className="muted rule">
          You can record results for yourself or someone else.
        </p>
      </form>
    </PageShell>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" width="20" height="20">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
