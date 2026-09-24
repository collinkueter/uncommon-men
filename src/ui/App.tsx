import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useConference } from "@/lib/ConferenceContext";
import { PageShell, withDemo } from "./shared";
import { Welcome } from "./Welcome";
import { Events } from "./Events";
import { ScoreEvent } from "./ScoreEvent";
import { Standings } from "./Standings";
import { Results } from "./Results";
import { RouteScroll } from "./RouteScroll";
const Admin = lazy(() =>
  import("./Admin").then(({ Admin }) => ({ default: Admin })),
);

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
      <Route path="/events/:eventId" element={<ScoreEvent />} />
      <Route path="/standings" element={<Standings />} />
      <Route path="/results" element={<Results />} />
      <Route
        path="/admin"
        element={
          <Suspense fallback={null}>
            <Admin />
          </Suspense>
        }
      />
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
