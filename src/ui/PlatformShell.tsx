import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { usePlatform } from "@/lib/PlatformContext";
import { withDemo } from "./shared";
import "./Platform.css";

/** Page chrome outside any conference: the directory and the organizer area. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { snapshot, store } = usePlatform();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" to={withDemo("/")}>
          UNCOMMON <em>MEN</em>
          <i />
        </Link>
        <button
          className="mobile-menu"
          onClick={() => setMenu(!menu)}
          aria-label={menu ? "Close menu" : "Open menu"}
          aria-expanded={menu}
          aria-controls="platform-navigation"
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav id="platform-navigation" aria-label="Primary navigation" className={menu ? "open" : ""}>
          <Link to={withDemo("/")}>Conferences</Link>
          {snapshot.identity?.organizer && <Link to={withDemo("/organizer")}>Organizer</Link>}
        </nav>
      </header>
      {snapshot.error ? (
        <div className="notice error" role="alert">
          {snapshot.error}
          <button onClick={() => store.clearError()} aria-label="Dismiss notification">
            <X />
          </button>
        </div>
      ) : (
        snapshot.mode === "demo" && (
          <div className="notice demo" role="status">DEMO MODE · Sample conferences stored in this browser</div>
        )
      )}
      {children}
      <footer className="build-version">Version {__APP_COMMIT__}</footer>
    </main>
  );
}
