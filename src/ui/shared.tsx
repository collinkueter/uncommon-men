import { useSyncExternalStore } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Trophy, X } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { conferencePath, relativeConferencePath } from "@/lib/conferencePaths";
import type { Competition } from "@/domain/types";
import { SiteShell } from "./SiteShell";
import { readLastConference } from "@/lib/lastConference";
import "./styles.css";
import "./Profile.css";
import "./Platform.css";
export { Audit } from "./Audit";

export const nowId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
export const demoQuery = () =>
  new URLSearchParams(window.location.search).get("demo") === "1";
export const withDemo = (path: string) =>
  `${path}${demoQuery() ? (path.includes("?") ? "&" : "?") + "demo=1" : ""}`;
/**
 * Builds in-app links for the current conference: a conference-relative path
 * such as `/events/push-up` becomes `/c/<slug>/events/push-up`, keeping ?demo=1.
 * Every internal link and navigate() goes through this.
 */
export function useConferenceLink() {
  const { conferenceId } = useConference();
  return (path: string) => withDemo(conferencePath(conferenceId, path));
}
/** The current route relative to its conference, for ?next= return paths. */
export function useConferenceRelativePath() {
  return relativeConferencePath(useLocation().pathname);
}
export const scoreLabel = (event: Competition) => {
  if (event.kind === "bracket") return event.team ? "Team bracket" : "Bracket";
  if (event.kind === "knockout") return "Single-winner game";
  if (event.kind === "duration")
    return event.direction === "higher" ? "Longest time" : "Fastest time";
  if (event.kind === "distance")
    return event.direction === "higher"
      ? "Farthest distance"
      : "Shortest distance";
  return event.direction === "higher"
    ? `Most ${event.unit}`
    : `Fewest ${event.unit}`;
};

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};

export function Button({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`button ${className}`} {...props}>
      {children}
    </button>
  );
}
export function PageShell({
  children,
  lockWhenArchived = true,
}: {
  children: React.ReactNode;
  /** Disable every form control while the conference is archived. */
  lockWhenArchived?: boolean;
}) {
  const { snapshot } = useConference();
  const link = useConferenceLink();
  const here = useConferenceRelativePath();
  const archived = snapshot.conference?.status === "archived";
  const identity = snapshot.identity;
  const remembered = readLastConference(snapshot.mode === "demo");
  return (
    <SiteShell
      conference={{
        id: snapshot.conferenceId,
        // While the conference loads, the name remembered from the last visit.
        name:
          snapshot.conference?.name ??
          (remembered?.id === snapshot.conferenceId ? remembered.name : ""),
      }}
      admin={identity?.admin}
      organizer={identity?.organizer}
      profile={
        identity
          ? { name: identity.name, to: link(`/welcome?next=${encodeURIComponent(here)}`) }
          : undefined
      }
      getStarted={link("/welcome")}
      notices={<Status />}
    >
      {archived && lockWhenArchived ? (
        <fieldset className="archive-lock" disabled>
          {children}
        </fieldset>
      ) : (
        children
      )}
    </SiteShell>
  );
}
export function Status() {
  const { snapshot, clearError } = useConference();
  if (snapshot.error)
    return (
      <div className="notice error" role="alert">
        {snapshot.error}
        <button onClick={clearError} aria-label="Dismiss notification">
          <X />
        </button>
      </div>
    );
  if (snapshot.loading)
    return <div className="notice" role="status">Loading competition data…</div>;
  if (snapshot.conference?.status === "archived")
    return (
      <div className="notice archived" role="status">
        {snapshot.conference.name} is archived. Results are read-only.
      </div>
    );
  if (snapshot.mode === "demo")
    return (
      <div className="notice demo" role="status">DEMO MODE · Sample competition data</div>
    );
  if (!snapshot.connected)
    return (
      <div className="notice offline" role="status">
        Offline. Showing saved standings. Reconnect before saving.
      </div>
    );
  return null;
}
export function RequireIdentity({ children }: { children: React.ReactNode }) {
  const { snapshot } = useConference();
  const link = useConferenceLink();
  const here = useConferenceRelativePath();
  if (snapshot.identityLoading)
    return (
      <PageShell>
        <div />
      </PageShell>
    );
  return snapshot.identity?.name.trim() ? (
    <>{children}</>
  ) : (
    <Navigate
      to={link(`/welcome?next=${encodeURIComponent(here)}`)}
      replace
    />
  );
}

export function formatDuration(value: number) {
  const centiseconds = Math.round(value * 100);
  const mins = Math.floor(centiseconds / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const hundredths = centiseconds % 100;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
export function parseDuration(v: string) {
  const bits = v.trim().replace(",", ".").split(":");
  if (bits.length === 2) {
    const seconds = Number(bits[1]);
    const minutes = Number(bits[0]);
    return Number.isFinite(minutes + seconds) &&
      minutes >= 0 &&
      seconds >= 0 &&
      seconds < 60
      ? minutes * 60 + seconds
      : NaN;
  }
  const n = bits.length === 1 ? Number(bits[0]) : NaN;
  return n > 0 ? n : NaN;
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Trophy />
      <p>{text}</p>
    </div>
  );
}
