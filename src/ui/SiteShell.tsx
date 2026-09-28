import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { CalendarDays, CircleUserRound, Menu, Trophy, X } from "lucide-react";
import { conferencePath } from "@/lib/conferencePaths";
import { ConferenceSwitcher } from "./ConferenceSwitcher";
import { withDemo } from "./shared";
import "./Shell.css";

export interface ShellConference {
  id: string;
  name: string;
}

export interface ShellProps {
  /** The conference the navigation points into; absent when none is known yet. */
  conference?: ShellConference;
  admin?: boolean;
  organizer?: boolean;
  /** The viewer's name and where it links, or where to get started. */
  profile?: { name: string; to?: string };
  getStarted?: string;
  notices?: ReactNode;
  children: ReactNode;
}

/**
 * The page chrome for every screen: one header, one navigation, one page
 * container and, on phones, one bottom bar. Conference pages and the pages
 * outside any conference (directory, organizer) differ only in what they pass.
 */
export function SiteShell({ conference, admin, organizer, profile, getStarted, notices, children }: ShellProps) {
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  const inConference = (path: string) => withDemo(conferencePath(conference!.id, path));
  const home = conference ? inConference("/events") : withDemo("/");
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-block">
            <Link className="brand" to={home}>
              UNCOMMON <em>MEN</em>
              <i />
            </Link>
            {conference ? (
              <ConferenceSwitcher conferenceId={conference.id} name={conference.name} organizer={Boolean(organizer)} />
            ) : (
              <Link className="conference-pick" to={withDemo("/")}>
                Choose a conference
              </Link>
            )}
          </div>
          <button
            className="mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="primary-navigation"
          >
            {menu ? <X /> : <Menu />}
          </button>
          <nav id="primary-navigation" aria-label="Primary navigation" className={menu ? "open" : ""}>
            {conference ? (
              <>
                <NavLink to={inConference("/events")}>Events</NavLink>
                <NavLink to={inConference("/standings")}>Standings</NavLink>
                <NavLink to={inConference("/results")}>My results</NavLink>
              </>
            ) : (
              <NavLink to={withDemo("/")} end>
                Conferences
              </NavLink>
            )}
            {(admin || organizer) && (
              <span className="nav-staff">
                {conference && <NavLink to={inConference("/admin")}>Admin</NavLink>}
                {organizer && <NavLink to={withDemo("/organizer")}>Organizer</NavLink>}
              </span>
            )}
          </nav>
          <div className="identity profile-identity">
            {profile ? (
              profile.to ? (
                <Link className="profile-link" to={profile.to} aria-label={`Change name for ${profile.name}`}>
                  <CircleUserRound aria-hidden="true" />
                  <span className="profile-name">{profile.name}</span>
                </Link>
              ) : (
                <span className="profile-link">
                  <CircleUserRound aria-hidden="true" />
                  <span className="profile-name">{profile.name}</span>
                </span>
              )
            ) : (
              getStarted && <Link to={getStarted}>Get started</Link>
            )}
          </div>
        </div>
      </header>
      {notices}
      <main className="page-main">{children}</main>
      <footer className="build-version">Version {__APP_COMMIT__}</footer>
      {conference && <BottomNav conferenceId={conference.id} />}
    </div>
  );
}

function BottomNav({ conferenceId }: { conferenceId: string }) {
  const to = (path: string) => withDemo(conferencePath(conferenceId, path));
  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      <NavLink to={to("/events")}>
        <CalendarDays aria-hidden="true" />
        Events
      </NavLink>
      <NavLink to={to("/standings")}>
        <Trophy aria-hidden="true" />
        Standings
      </NavLink>
      <NavLink to={to("/results")}>
        <CircleUserRound aria-hidden="true" />
        My results
      </NavLink>
    </nav>
  );
}
