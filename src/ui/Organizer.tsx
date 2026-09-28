import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Clock3,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { initialCategories, initialEvents } from "@/domain/catalog";
import {
  copyCatalog,
  detailsError,
  directorySections,
  emailError,
  formatDateRange,
  normalizeEmail,
  parseEmailList,
  slugError,
  statusAction,
  suggestSlug,
  SLUG_MAX_LENGTH,
  type CatalogCopy,
} from "@/domain/conferences";
import type { AuditEntry, Conference, PlatformSnapshot } from "@/domain/types";
import { conferencePath } from "@/lib/conferencePaths";
import { usePlatform } from "@/lib/PlatformContext";
import { ConferenceAdmins, ConferenceDetailsForm } from "./ConferenceManagement";
import { PlatformShell } from "./PlatformShell";
import { Button, withDemo } from "./shared";
import { ThemedSelect } from "./ThemedSelect";

const BUILT_IN = "__catalog__";
type Tab = "conferences" | "new" | "organizers" | "activity";
const tabs: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "conferences", label: "Conferences", icon: Building2 },
  { id: "new", label: "New conference", icon: Plus },
  { id: "organizers", label: "Organizers", icon: Users },
  { id: "activity", label: "Activity", icon: Clock3 },
];

function OrganizerLogin({ snapshot, signIn, signOut }: { snapshot: PlatformSnapshot; signIn: () => void; signOut: () => void }) {
  const signedIn = snapshot.identity;
  return (
    <section className="admin-login">
      <ShieldCheck />
      <h1>ORGANIZER ACCESS</h1>
      {signedIn ? (
        <>
          <p>
            {signedIn.email ?? signedIn.name} does not have organizer access. Ask an organizer to add this Google
            account, or sign in with another one.
          </p>
          <Button type="button" className="primary" onClick={signIn}>
            {snapshot.mode === "demo" ? "Enter demo organizer" : "Use another Google account"}
          </Button>
          {snapshot.mode !== "demo" && (
            <Button type="button" onClick={signOut}>
              Sign out
            </Button>
          )}
        </>
      ) : (
        <>
          <p>Sign in with an organizer's Google account to create conferences and manage roles.</p>
          <Button type="button" className="primary" onClick={signIn}>
            {snapshot.mode === "demo" ? "Enter demo organizer" : "Sign in with Google"}
          </Button>
        </>
      )}
      {snapshot.mode === "demo" && <small>Demo mode stores conferences in this browser only.</small>}
    </section>
  );
}

function ConferenceRow({ conference, isDefault }: { conference: Conference; isDefault: boolean }) {
  const { store } = usePlatform();
  const [open, setOpen] = useState<"" | "details" | "admins">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const next = statusAction(conference.status);
  const act = async (operation: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the conference.");
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = () => {
    if (next.to === "archived" && !window.confirm(`Archive ${conference.name}? Its results become read-only.`)) return;
    void act(() => store.updateConference(conference.id, { status: next.to }), `${conference.name} is now ${next.to}.`);
  };
  return (
    <article className="organizer-conference">
      <header>
        <div>
          <strong>{conference.name}</strong>
          <small>
            /c/{conference.id} · {formatDateRange(conference.startDate, conference.endDate)}
            {conference.location && ` · ${conference.location}`}
          </small>
        </div>
        <div className="badges">
          <em className={`status-badge ${conference.status}`}>{conference.status}</em>
          {isDefault && <em className="status-badge default">default</em>}
        </div>
      </header>
      <div className="row-actions">
        <Link className="button compact" to={withDemo(conferencePath(conference.id))}>
          Open
        </Link>
        <Button type="button" className="compact" disabled={busy} onClick={changeStatus}>
          {next.label}
        </Button>
        <Button
          type="button"
          className={`compact ${open === "details" ? "active" : ""}`}
          aria-expanded={open === "details"}
          onClick={() => setOpen(open === "details" ? "" : "details")}
        >
          Edit details
        </Button>
        <Button
          type="button"
          className={`compact ${open === "admins" ? "active" : ""}`}
          aria-expanded={open === "admins"}
          onClick={() => setOpen(open === "admins" ? "" : "admins")}
        >
          Admins
        </Button>
        <Button
          type="button"
          className="compact"
          disabled={busy || isDefault || conference.status === "draft"}
          title={conference.status === "draft" ? "Publish the conference before making it the default." : undefined}
          onClick={() =>
            void act(() => store.setDefaultConference(conference.id), `${conference.name} is now the default conference.`)
          }
        >
          Set as default
        </Button>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
      {open === "details" && <ConferenceDetailsForm conference={conference} onDone={() => setOpen("")} />}
      {open === "admins" && <ConferenceAdmins conference={conference} canManage />}
    </article>
  );
}

function ConferencesTab({ snapshot, onNew }: { snapshot: PlatformSnapshot; onNew: () => void }) {
  const sections = directorySections(snapshot.conferences, true);
  const ordered = [...sections.current, ...sections.drafts, ...sections.past];
  return (
    <>
      <h1>CONFERENCES</h1>
      <p className="muted">
        The default conference is where old links and printed QR codes (for example /events/push-up) land.
      </p>
      <Button type="button" className="primary" onClick={onNew}>
        <Plus aria-hidden="true" /> New conference
      </Button>
      {snapshot.conferencesLoading ? (
        <div className="route-pending" aria-busy="true" />
      ) : (
        <div className="organizer-list">
          {ordered.map((conference) => (
            <ConferenceRow
              key={conference.id}
              conference={conference}
              isDefault={conference.id === snapshot.defaultConferenceId}
            />
          ))}
        </div>
      )}
    </>
  );
}

function NewConferenceForm({ snapshot, onCreated }: { snapshot: PlatformSnapshot; onCreated: () => void }) {
  const { store } = usePlatform();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<"draft" | "live">("draft");
  const [source, setSource] = useState(BUILT_IN);
  const [catalog, setCatalog] = useState<CatalogCopy | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adminText, setAdminText] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const existingIds = useMemo(() => snapshot.conferences.map((item) => item.id), [snapshot.conferences]);

  useEffect(() => {
    let current = true;
    setCatalog(null);
    setCatalogError("");
    const load =
      source === BUILT_IN
        ? Promise.resolve(copyCatalog({ categories: initialCategories, events: initialEvents }))
        : store.readCatalog(source);
    load.then(
      (result) => {
        if (!current) return;
        setCatalog(result);
        setSelected(new Set(result.events.filter((event) => event.active).map((event) => event.id)));
      },
      (reason: unknown) => {
        if (current) setCatalogError(reason instanceof Error ? reason.message : "Could not load those events.");
      },
    );
    return () => {
      current = false;
    };
  }, [source, store]);

  const effectiveSlug = slugTouched ? slug : suggestSlug(name);
  const slugProblem = effectiveSlug || name ? slugError(effectiveSlug, existingIds) : null;
  const sourceName = source === BUILT_IN ? "the built-in catalog" : snapshot.conferences.find((item) => item.id === source)?.name ?? source;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    const admins = parseEmailList(adminText);
    const problem =
      slugError(effectiveSlug, existingIds) ??
      detailsError({ name, startDate, endDate, location }) ??
      admins.errors[0] ??
      (catalog ? null : "The starting events are still loading.");
    if (problem) return setError(problem);
    setError("");
    setProgress("Creating…");
    try {
      await store.createConference(
        {
          name,
          slug: effectiveSlug,
          startDate,
          endDate,
          location,
          status,
          categories: catalog!.categories,
          events: catalog!.events.filter((event) => selected.has(event.id)),
          adminEmails: admins.emails,
          sourceLabel: source === BUILT_IN ? "built-in catalog" : `copied from ${source}`,
        },
        (done, total) => setProgress(`Creating… step ${done} of ${total}`),
      );
      setCreated({ id: effectiveSlug, name: name.trim() });
      setProgress("");
    } catch (reason) {
      setProgress("");
      setError(reason instanceof Error ? reason.message : "Could not create the conference.");
    }
  };

  if (created)
    return (
      <div className="created-panel" role="status">
        <h1>CONFERENCE CREATED</h1>
        <p>
          <strong>{created.name}</strong> is ready at <code>/c/{created.id}</code>.
          {status === "draft" && " It is a draft: only organizers and its admins can see it until you publish it."}
        </p>
        <div className="form-actions">
          <Link className="button primary" to={withDemo(conferencePath(created.id))}>
            Open conference
          </Link>
          <Link className="button" to={withDemo(conferencePath(created.id, "/admin"))}>
            Conference admin
          </Link>
          <Button type="button" onClick={onCreated}>
            Back to conferences
          </Button>
        </div>
      </div>
    );

  const categories = catalog?.categories ?? [];
  const events = catalog?.events ?? [];
  const busy = Boolean(progress);
  return (
    <form
      className="new-conference"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1>NEW CONFERENCE</h1>
      <fieldset disabled={busy}>
        <div className="admin-grid">
          <label className="wide">
            Conference name
            <input value={name} maxLength={100} placeholder="Uncommon Men 2027" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="wide">
            Web address
            <span className="slug-input">
              <span aria-hidden="true">/c/</span>
              <input
                value={effectiveSlug}
                maxLength={SLUG_MAX_LENGTH}
                aria-describedby="slug-help"
                aria-invalid={Boolean(slugProblem)}
                placeholder="uncommon-men-2027"
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value.toLowerCase());
                }}
              />
            </span>
            <small id="slug-help" className={slugProblem ? "field-error" : "field-help"}>
              {slugProblem ?? "Lowercase letters, numbers and hyphens. It cannot be changed later."}
            </small>
          </label>
          <label>
            Start date
            <input type="date" value={startDate} onChange={(event) => {
              setStartDate(event.target.value);
              if (!endDate || endDate < event.target.value) setEndDate(event.target.value);
            }} />
          </label>
          <label>
            End date
            <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label className="wide">
            Location
            <input value={location} maxLength={120} placeholder="City or venue" onChange={(event) => setLocation(event.target.value)} />
          </label>
        </div>
        <h2>STATUS</h2>
        <div className="segment" role="group" aria-label="Initial status">
          <button type="button" className={status === "draft" ? "active" : ""} aria-pressed={status === "draft"} onClick={() => setStatus("draft")}>
            Draft
          </button>
          <button type="button" className={status === "live" ? "active" : ""} aria-pressed={status === "live"} onClick={() => setStatus("live")}>
            Live
          </button>
        </div>
        <p className="muted">
          {status === "draft"
            ? "Hidden from everyone except organizers and its admins until you publish it."
            : "Listed in the directory and open for results as soon as it is created."}
        </p>
        <h2>STARTING EVENTS</h2>
        <div className="admin-field">
          <label htmlFor="event-source">Copy events from</label>
          <ThemedSelect
            id="event-source"
            label="Copy events from"
            value={source}
            onChange={setSource}
            options={[
              { value: BUILT_IN, label: "Built-in event catalog" },
              ...snapshot.conferences.map((item) => ({ value: item.id, label: `${item.name} (${item.status})` })),
            ]}
          />
        </div>
        <p className="muted">
          Categories, events, instructions and scoring are copied. Participants, teams and results never are.
        </p>
        {catalogError ? (
          <p className="form-message">{catalogError}</p>
        ) : !catalog ? (
          <p className="muted">Loading events…</p>
        ) : (
          <div className="event-picker">
            <div className="form-actions">
              <Button type="button" className="compact" onClick={() => setSelected(new Set(events.map((event) => event.id)))}>
                Select all
              </Button>
              <Button type="button" className="compact" onClick={() => setSelected(new Set())}>
                Select none
              </Button>
              <span className="muted">
                {selected.size} of {events.length} events from {sourceName}
              </span>
            </div>
            {categories.map((category) => {
              const inCategory = events.filter((event) => event.categoryId === category.id);
              if (!inCategory.length) return null;
              return (
                <fieldset key={category.id} className="event-group">
                  <legend>{category.name}</legend>
                  {inCategory.map((event) => (
                    <label key={event.id} className="check">
                      <input type="checkbox" checked={selected.has(event.id)} onChange={() => toggle(event.id)} />
                      {event.name}
                      {!event.active && <small className="muted"> (inactive)</small>}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        )}
        <h2>CONFERENCE ADMINS</h2>
        <label>
          Google emails (optional)
          <textarea
            value={adminText}
            placeholder="one@example.com, two@example.com"
            onChange={(event) => setAdminText(event.target.value)}
          />
          <small className="field-help">
            Each person must sign in with that Google account. They can manage this conference only; organizers can manage every conference.
          </small>
        </label>
        <div className="form-actions">
          <Button type="submit" className="primary" disabled={busy || !catalog}>
            {progress || "Create conference"}
          </Button>
        </div>
      </fieldset>
      {error && <p className="form-message" role="alert">{error}</p>}
    </form>
  );
}

function OrganizersTab({ snapshot }: { snapshot: PlatformSnapshot }) {
  const { store } = usePlatform();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const self = snapshot.identity?.email?.toLowerCase();
  const change = async (target: string, grant: boolean) => {
    if (grant) {
      const error = emailError(target);
      if (error) return setMessage(error);
    }
    const key = normalizeEmail(target);
    const warning = key === self ? " You will lose organizer access yourself." : "";
    if (!grant && !window.confirm(`Remove organizer access for ${key}?${warning}`)) return;
    setBusy(key);
    setMessage("");
    try {
      await store.setOrganizer(key, grant);
      if (grant) setEmail("");
      setMessage(grant ? `${key} is now an organizer.` : `${key} is no longer an organizer.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change organizers.");
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <h1>ORGANIZERS</h1>
      <p className="muted">
        Organizers create conferences, publish and archive them, choose the default conference, and grant roles in
        every conference.
      </p>
      <ul className="role-list" aria-label="Organizers">
        {snapshot.organizers.map((organizer) => (
          <li key={organizer.email}>
            <span>
              {organizer.email}
              {organizer.email === self && <small className="muted"> (you)</small>}
            </span>
            <Button
              type="button"
              className="danger compact"
              disabled={busy === organizer.email}
              onClick={() => void change(organizer.email, false)}
              aria-label={`Revoke ${organizer.email}`}
            >
              <Trash2 aria-hidden="true" /> Revoke
            </Button>
          </li>
        ))}
        {!snapshot.organizers.length && <li className="muted">No organizers are stored in the app yet.</li>}
      </ul>
      <form
        className="role-add"
        onSubmit={(event) => {
          event.preventDefault();
          void change(email, true);
        }}
      >
        <label>
          Add organizer by Google email
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            placeholder="name@example.com"
            onChange={(event) => {
              setEmail(event.target.value);
              setMessage("");
            }}
          />
        </label>
        <Button type="submit" className="primary" disabled={!email.trim() || Boolean(busy)}>
          <UserPlus aria-hidden="true" /> Add organizer
        </Button>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <p className="role-help">
        The person must sign in with that Google account; access applies right away. Accounts with the legacy
        administrator claim are also organizers but are not listed here: they are managed with the operator CLI
        (<code>scripts/admin-access.ts grant|revoke</code>).
      </p>
    </>
  );
}

function describe(entry: AuditEntry) {
  const after = entry.after as Record<string, unknown> | null;
  switch (entry.action) {
    case "grantOrganizer":
      return `Made ${entry.entityId} an organizer`;
    case "revokeOrganizer":
      return `Removed organizer ${entry.entityId}`;
    case "setDefaultConference":
      return `Set the default conference to ${String(after?.defaultConferenceId ?? "")}`;
    case "createConference":
      return `Created conference ${entry.entityId}`;
    case "setConferenceStatus":
      return `Set ${entry.entityId} to ${String(after?.status ?? "")}`;
    case "grantAdmin":
      return `Made ${entry.entityId} a conference admin`;
    case "revokeAdmin":
      return `Removed conference admin ${entry.entityId}`;
    default:
      return `${entry.action} ${entry.entityId}`;
  }
}

function ActivityTab({ snapshot }: { snapshot: PlatformSnapshot }) {
  return (
    <>
      <h1>ACTIVITY</h1>
      <p className="muted">
        Organizer and default-conference changes. Each conference's own audit log (on its admin page) records its
        details, status, admins and results.
      </p>
      <div className="audit-list">
        {snapshot.audit.map((entry) => (
          <article key={entry.id}>
            <Clock3 aria-hidden="true" />
            <div>
              <strong>{describe(entry)}</strong>
              <small>
                {entry.actorName} · {entry.at ? new Date(entry.at).toLocaleString() : "just now"}
              </small>
            </div>
          </article>
        ))}
        {!snapshot.audit.length && <p className="muted">No organizer activity yet.</p>}
      </div>
    </>
  );
}

/** `/organizer`: conferences, roles and the default conference, for organizers only. */
export function Organizer() {
  const { snapshot, store } = usePlatform();
  const [tab, setTab] = useState<Tab>("conferences");
  const [signInError, setSignInError] = useState("");
  const signIn = () => {
    setSignInError("");
    void store.signIn().catch((error: unknown) => setSignInError(error instanceof Error ? error.message : String(error)));
  };
  const signOut = () => void store.signOut();
  useEffect(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }), [tab]);
  if (snapshot.identityLoading)
    return (
      <PlatformShell>
        <div className="route-pending" aria-busy="true" />
      </PlatformShell>
    );
  if (!snapshot.identity?.organizer)
    return (
      <PlatformShell>
        <OrganizerLogin snapshot={snapshot} signIn={signIn} signOut={signOut} />
        {signInError && <p className="form-message centered">{signInError}</p>}
      </PlatformShell>
    );
  return (
    <PlatformShell>
      <section className="admin organizer">
        <aside>
          <h2>ORGANIZER</h2>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon />
              {label}
            </button>
          ))}
          <Button type="button" onClick={signOut}>
            Sign out
          </Button>
        </aside>
        <div className="admin-main">
          <p className="signed-in-as muted">Signed in as {snapshot.identity.email ?? snapshot.identity.name}</p>
          {tab === "conferences" && <ConferencesTab snapshot={snapshot} onNew={() => setTab("new")} />}
          {tab === "new" && <NewConferenceForm snapshot={snapshot} onCreated={() => setTab("conferences")} />}
          {tab === "organizers" && <OrganizersTab snapshot={snapshot} />}
          {tab === "activity" && <ActivityTab snapshot={snapshot} />}
        </div>
      </section>
    </PlatformShell>
  );
}
