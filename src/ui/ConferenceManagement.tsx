// Conference settings shared by /organizer and /c/:slug/admin: descriptive
// details (conference admins and organizers) and the conference's admins
// (listed for both, granted and revoked by organizers).
import { useEffect, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { detailsError, emailError, normalizeEmail, type ConferenceDetails } from "@/domain/conferences";
import type { Conference, RoleGrant } from "@/domain/types";
import { usePlatform } from "@/lib/PlatformContext";
import { Button } from "./shared";

export function ConferenceDetailsForm({
  conference,
  disabled = false,
  onDone,
}: {
  conference: Conference;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const { store } = usePlatform();
  const [details, setDetails] = useState<ConferenceDetails>(() => ({
    name: conference.name,
    startDate: conference.startDate,
    endDate: conference.endDate,
    location: conference.location,
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const update = (key: keyof ConferenceDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  const unchanged =
    details.name === conference.name &&
    details.startDate === conference.startDate &&
    details.endDate === conference.endDate &&
    details.location === conference.location;
  const save = async () => {
    const error = detailsError(details);
    if (error) return setMessage(error);
    setSaving(true);
    setMessage("");
    try {
      await store.updateConference(conference.id, details);
      setMessage("Conference details saved.");
      onDone?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the conference details.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="conference-details"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={disabled || saving}>
        <div className="admin-grid">
          <label className="wide">
            Conference name
            <input value={details.name} maxLength={100} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label>
            Start date
            <input type="date" value={details.startDate} onChange={(event) => update("startDate", event.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={details.endDate} onChange={(event) => update("endDate", event.target.value)} />
          </label>
          <label className="wide">
            Location
            <input
              value={details.location}
              maxLength={120}
              placeholder="City or venue"
              onChange={(event) => update("location", event.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <Button type="submit" className="primary" disabled={unchanged}>
            {saving ? "Saving…" : "Save details"}
          </Button>
          {onDone && (
            <Button type="button" onClick={onDone}>
              Cancel
            </Button>
          )}
        </div>
      </fieldset>
      {message && <p className="form-message" role="status">{message}</p>}
    </form>
  );
}

/** Emails with admin access to one conference; organizers can add and revoke them. */
export function ConferenceAdmins({
  conference,
  canManage,
}: {
  conference: Conference;
  canManage: boolean;
}) {
  const { store } = usePlatform();
  const [admins, setAdmins] = useState<RoleGrant[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  useEffect(
    () =>
      store.watchConferenceAdmins(conference.id, (list, error) => {
        setAdmins(list);
        setLoadError(error ?? "");
      }),
    [store, conference.id],
  );
  const archived = conference.status === "archived";
  const change = async (target: string, grant: boolean) => {
    if (grant) {
      const error = emailError(target);
      if (error) return setMessage(error);
    }
    const key = normalizeEmail(target);
    if (!grant && !window.confirm(`Remove ${key} as an admin of ${conference.name}?`)) return;
    setBusy(key);
    setMessage("");
    try {
      await store.setConferenceAdmin(conference.id, key, grant);
      if (grant) setEmail("");
      setMessage(grant ? `${key} can now manage ${conference.name}.` : `${key} no longer manages ${conference.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change conference admins.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="role-manager">
      {loadError ? (
        <p className="form-message">{loadError}</p>
      ) : admins === null ? (
        <p className="muted">Loading admins…</p>
      ) : admins.length ? (
        <ul className="role-list" aria-label={`Admins of ${conference.name}`}>
          {admins.map((admin) => (
            <li key={admin.email}>
              <span>{admin.email}</span>
              {canManage && (
                <Button
                  type="button"
                  className="danger compact"
                  disabled={archived || busy === admin.email}
                  onClick={() => void change(admin.email, false)}
                  aria-label={`Revoke ${admin.email}`}
                >
                  <Trash2 aria-hidden="true" /> Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No conference admins yet. Organizers can manage every conference.</p>
      )}
      {canManage && (
        <form
          className="role-add"
          onSubmit={(event) => {
            event.preventDefault();
            void change(email, true);
          }}
        >
          <label>
            Add admin by Google email
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              disabled={archived}
              placeholder="name@example.com"
              onChange={(event) => {
                setEmail(event.target.value);
                setMessage("");
              }}
            />
          </label>
          <Button type="submit" className="primary" disabled={archived || !email.trim() || Boolean(busy)}>
            <UserPlus aria-hidden="true" /> Add admin
          </Button>
        </form>
      )}
      {canManage && (
        <p className="role-help">
          {archived
            ? "Archived conferences are read-only. Unarchive it to change its admins."
            : "The person must sign in with that Google account. Access applies right away, without signing in again."}
        </p>
      )}
      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  );
}
