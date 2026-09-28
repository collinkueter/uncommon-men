import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ConferenceProvider, useConference } from "@/lib/ConferenceContext";
import { legacyRedirectPath } from "@/lib/conferencePaths";
import { loadDefaultConferenceId, peekDefaultConferenceId } from "@/lib/defaultConference";
import { Button, PageShell, useConferenceLink } from "./shared";
import { Welcome } from "./Welcome";
import { Events } from "./Events";
import { RouteScroll } from "./RouteScroll";

// Welcome and Events are the two landing screens, so they ship in the main
// chunk. Everything else loads when first opened.
const ScoreEvent = lazy(() =>
  import("./ScoreEvent").then(({ ScoreEvent }) => ({ default: ScoreEvent })),
);
const Standings = lazy(() =>
  import("./Standings").then(({ Standings }) => ({ default: Standings })),
);
const Results = lazy(() =>
  import("./Results").then(({ Results }) => ({ default: Results })),
);
const Admin = lazy(() =>
  import("./Admin").then(({ Admin }) => ({ default: Admin })),
);

function Deferred({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<PageShell><div className="route-pending" aria-busy="true" /></PageShell>}>
      {children}
    </Suspense>
  );
}

/** Missing conferences and drafts the viewer may not see look the same. */
export function ConferenceNotFound() {
  const { snapshot, signInWithGoogle } = useConference();
  const signedInWithGoogle = Boolean(snapshot.identity?.email);
  return (
    <PageShell>
      <section className="content conference-missing">
        <h1>Conference not found</h1>
        <p>
          There is no conference at this address, or it is not open yet. Check
          the link or QR code you used.
        </p>
        {!signedInWithGoogle && snapshot.mode === "firebase" && (
          <>
            <p>Conference administrators can sign in to open a draft conference.</p>
            <Button type="button" className="primary" onClick={() => void signInWithGoogle().catch(() => undefined)}>
              Administrator sign-in
            </Button>
          </>
        )}
      </section>
    </PageShell>
  );
}

export function ConferenceRoutes() {
  const { snapshot } = useConference();
  const link = useConferenceLink();
  if (snapshot.conferenceState === "missing") return <ConferenceNotFound />;
  return (
    <Routes>
      <Route
        index
        element={
          snapshot.loading || snapshot.identityLoading ? <PageShell><div /></PageShell> :
          <Navigate
            to={link(snapshot.identity?.name.trim() ? "/events" : "/welcome")}
            replace
          />
        }
      />
      <Route path="welcome" element={<Welcome />} />
      <Route path="events" element={<Events />} />
      <Route path="events/:eventId" element={<Deferred><ScoreEvent /></Deferred>} />
      <Route path="standings" element={<Deferred><Standings /></Deferred>} />
      <Route path="results" element={<Deferred><Results /></Deferred>} />
      <Route path="admin" element={<Deferred><Admin /></Deferred>} />
      <Route path="*" element={<Navigate to={link("/events")} replace />} />
    </Routes>
  );
}

function ConferenceRoute() {
  const { slug = "" } = useParams();
  return (
    <ConferenceProvider conferenceId={slug}>
      <ConferenceRoutes key={slug} />
    </ConferenceProvider>
  );
}

/**
 * Pre-multi-conference URLs (printed QR codes point at /events/<eventId>) keep
 * working: every path outside /c/ moves under the default conference with its
 * query string, so ?demo=1 survives.
 */
export function LegacyRedirect({ defaultConferenceId }: { defaultConferenceId?: string }) {
  const location = useLocation();
  const [loaded, setLoaded] = useState<string | undefined>(
    () => defaultConferenceId ?? peekDefaultConferenceId(),
  );
  useEffect(() => {
    if (loaded) return;
    let current = true;
    void loadDefaultConferenceId().then((id) => {
      if (current) setLoaded(id);
    });
    return () => {
      current = false;
    };
  }, [loaded]);
  if (!loaded)
    return (
      <main className="app-shell">
        <div className="route-pending" aria-busy="true" />
      </main>
    );
  return (
    <Navigate
      to={`${legacyRedirectPath(location.pathname, location.search, loaded)}${location.hash}`}
      replace
    />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/c/:slug/*" element={<ConferenceRoute />} />
      <Route path="*" element={<LegacyRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteScroll />
      <AppRoutes />
    </BrowserRouter>
  );
}
