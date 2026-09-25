import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, Navigate, NavLink, useLocation } from "react-router-dom";
import {
  CalendarDays,
  CircleUserRound,
  Menu,
  Trophy,
  X,
} from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import type { Competition } from "@/domain/types";
import "./styles.css";
import "./Profile.css";
export { Audit } from "./Audit";

export const nowId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
export const demoQuery = () =>
  new URLSearchParams(window.location.search).get("demo") === "1";
export const withDemo = (path: string) =>
  `${path}${demoQuery() ? (path.includes("?") ? "&" : "?") + "demo=1" : ""}`;
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

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      className={`brand ${compact ? "compact" : ""}`}
      to={withDemo("/events")}
    >
      UNCOMMON <em>MEN</em>
      <i />
    </Link>
  );
}
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
  bare = false,
}: {
  children: React.ReactNode;
  bare?: boolean;
}) {
  const { snapshot } = useConference();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);
  return (
    <main className={bare ? "presentation-shell" : "app-shell"}>
      <header className={`topbar ${bare ? "presentation-topbar" : ""}`}>
          <Brand />
          <button
            className="mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="primary-navigation"
          >
            {menu ? <X /> : <Menu />}
          </button>
          <nav
            id="primary-navigation"
            aria-label="Primary navigation"
            className={menu ? "open" : ""}
          >
            <Link to={withDemo("/events")}>Events</Link>
            <Link to={withDemo("/standings")}>Standings</Link>
            <Link to={withDemo("/results")}>My results</Link>
            {snapshot.identity?.admin && (
              <Link to={withDemo("/admin")}>Admin</Link>
            )}
          </nav>
          <div className="identity profile-identity">
            {snapshot.identity ? (
              <Link
                className="profile-link"
                to={withDemo(
                  `/welcome?next=${encodeURIComponent(location.pathname)}`,
                )}
                aria-label={`Change name for ${snapshot.identity.name}`}
              >
                <CircleUserRound aria-hidden="true" />
                <span className="profile-name">{snapshot.identity.name}</span>
              </Link>
            ) : (
              <Link to={withDemo("/welcome")}>Get started</Link>
            )}
          </div>
      </header>
      <Status />
      {children}
    </main>
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
  const location = useLocation();
  if (snapshot.loading)
    return (
      <PageShell>
        <div />
      </PageShell>
    );
  return snapshot.identity?.name.trim() ? (
    <>{children}</>
  ) : (
    <Navigate
      to={withDemo(`/welcome?next=${encodeURIComponent(location.pathname)}`)}
      replace
    />
  );
}

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink to={withDemo("/events")}>
        <CalendarDays />
        Events
      </NavLink>
      <NavLink to={withDemo("/standings")}>
        <Trophy />
        Standings
      </NavLink>
      <NavLink to={withDemo("/results")}>
        <CircleUserRound />
        My results
      </NavLink>
    </nav>
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
