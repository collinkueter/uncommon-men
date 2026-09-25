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
  const { snapshot, execute, signInWithGoogle, signOutAdmin } = useConference();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState(snapshot.identity?.name ?? "");
  const [selected, setSelected] = useState<Participant | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [googlePending, setGooglePending] = useState(false);
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
  const returnToNext = () => {
    const next = new URLSearchParams(location.search).get("next");
    navigate(withDemo(safeReturnPath(next)));
  };
  // Google sign-in can switch to a different account; wait until that
  // account's profile has loaded before leaving this screen.
  useEffect(() => {
    if (googlePending && snapshot.identity?.email && snapshot.identity.name.trim()) {
      setGooglePending(false);
      returnToNext();
    }
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
