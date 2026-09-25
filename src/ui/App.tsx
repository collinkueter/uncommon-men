import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { useConference } from "@/lib/ConferenceContext";
import { PageShell, withDemo } from "./shared";
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

function Router() {
  const { snapshot } = useConference();
  return (
    <Routes>
      <Route
        path="/"
        element={
          snapshot.loading ? <PageShell><div /></PageShell> :
          <Navigate
            to={withDemo(
              snapshot.identity?.name.trim() ? "/events" : "/welcome",
            )}
            replace
          />
        }
      />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/events" element={<Events />} />
      <Route path="/events/:eventId" element={<Deferred><ScoreEvent /></Deferred>} />
      <Route path="/standings" element={<Deferred><Standings /></Deferred>} />
      <Route path="/results" element={<Deferred><Results /></Deferred>} />
      <Route path="/admin" element={<Deferred><Admin /></Deferred>} />
      <Route path="*" element={<Navigate to={withDemo("/events")} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteScroll />
      <Router />
    </BrowserRouter>
  );
}
