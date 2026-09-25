import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Trophy } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { eventStandings, formatScore, overallStandings } from "@/domain/ranking";
import type { Competition, Standing } from "@/domain/types";
import { Brand, Button, Empty, PageShell, scoreLabel } from "./shared";
import { ThemedSelect } from "./ThemedSelect";

type Mode = "overall" | "events" | "teams";
type DisplayRow = Standing & { result?: string };
const modes: Mode[] = ["overall", "events", "teams"];

export function Standings() {
  const { snapshot } = useConference();
  const [mode, setMode] = useState<Mode>("overall");
  const [auto, setAuto] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  const [index, setIndex] = useState(0);
  const [fullscreenError, setFullscreenError] = useState("");
  const activeGroupRef = useRef<string | undefined>(undefined);
  const pendingGroupRef = useRef<string | undefined>(undefined);
  const groups = useMemo(() => {
    const state = snapshot.data;
    const eventGroup = (event: Competition) => {
      const bracket = state.brackets.find(b => b.eventId === event.id);
      let rows: DisplayRow[] = eventStandings(state, event.id);
      if (event.kind === "bracket" && bracket?.status !== "complete") {
        const entrants = bracket?.entrants ?? (event.team ? state.teams.filter(t => t.eventId === event.id).map(t => t.id) : []);
        rows = entrants.map(id => {
          const wins = bracket?.matches.filter(m => m.winnerId === id && !m.bye).length ?? 0;
          const eliminated = bracket?.matches.some(m => m.winnerId && m.winnerId !== id && [m.sideA, m.sideB].includes(id));
          return { id, name: state.participants.find(p => p.id === id)?.name ?? state.teams.find(t => t.id === id)?.name ?? "Entrant", rank: 0, points: 0, value: wins, eventsPlayed: wins, result: eliminated ? "Eliminated" : wins ? `${wins} win${wins === 1 ? "" : "s"}` : "Waiting" };
        });
      } else {
        rows = rows.map(row => ({ ...row, result: event.kind === "bracket" ? row.rank === 1 ? "Champion" : `Place ${row.rank}` : `${formatScore(row.value, event)}${event.kind === "duration" ? "" : ` ${event.unit}`}` }));
      }
      return { id: event.id, title: event.name, subtitle: "Competition", detail: event.kind === "bracket" ? `${event.team ? "Team championship · " : ""}${bracket?.status === "complete" ? "Final results" : "Single elimination · In progress"}` : scoreLabel(event), rows };
    };
    if (mode === "events" || mode === "teams") return state.events.filter(e => e.active && e.team === (mode === "teams")).map(eventGroup);
    return [{id: "overall", title: "Overall standings", subtitle: "Conference champion", detail: "Every individual event · Equal weight", rows: overallStandings(state) as DisplayRow[]}];
  }, [snapshot.data, mode]);
  const slides = useMemo(() => groups.flatMap(group => {
    const pages = Math.max(1, Math.ceil(group.rows.length / 5));
    const pageIndexes = auto && isMobile ? [0] : Array.from({length: pages}, (_, page) => page);
    return pageIndexes.map(page => ({...group, page, pages, rows: group.rows.slice(page * 5, page * 5 + 5)}));
  }), [auto, groups, isMobile]);
  const activeIndex = slides.length ? ((index % slides.length) + slides.length) % slides.length : 0;
  const slide = slides[activeIndex];
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const onChange = () => {
      if (auto) pendingGroupRef.current = activeGroupRef.current;
      setIsMobile(query.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [auto]);
  useEffect(() => {
    const groupId = pendingGroupRef.current;
    if (!groupId) return;
    const nextIndex = slides.findIndex(current => current.id === groupId);
    pendingGroupRef.current = undefined;
    if (nextIndex >= 0) setIndex(nextIndex);
  }, [slides]);
  useEffect(() => {
    activeGroupRef.current = slide?.id;
  }, [slide?.id]);
  useEffect(() => {
    if (!auto || slides.length < 2) return;
    const timer = window.setInterval(() => setIndex(i => i + 1), 6500);
    return () => window.clearInterval(timer);
  }, [auto, slides.length]);
  return <PageShell bare><section className="presentation">
    <div className="present-head">
      <div className="present-motto">STRONGER MEN<br/>BUILD A BRIGHTER<br/>TOMORROW</div>
      <div><Brand/><p className="present-tagline">CHARACTER · COMPETITION · COMMUNITY</p></div>
      <div className="live"><span/> LIVE STANDINGS</div>
    </div>
    <div className="stand-tabs">{modes.map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? "active" : ""} onClick={() => {setMode(m); setIndex(0);}}>{m}</button>)}</div>
    <div className="stand-title"><div className="stand-event-icon"><Trophy/></div><div><span className="eyebrow">{slide?.subtitle ?? "Competition"}</span><h1>{slide?.title ?? "Standings"}</h1><p className="stand-subtitle">{slide?.detail}</p></div>
      {groups.length > 1 && <ThemedSelect className="standings-filter" label="Displayed competition" value={slide?.id ?? ""} onChange={value => setIndex(slides.findIndex(s => s.id === value))} options={groups.map(g => ({value:g.id,label:g.title}))} />}
    </div>
    {slide?.rows.length ? <div className="standing-rows">{slide.rows.map(row => <div className={`standing-row ${row.rank === 1 ? "leader" : ""}`} key={row.id}><b>{row.rank || "—"}</b><strong>{row.name}</strong><span>{row.result ?? `${Number(row.points.toFixed(2))} PTS`}</span></div>)}</div> : <Empty text="Results will appear here when attempts are recorded."/>}
    <div className="presentation-controls">
      <Button disabled={slides.length < 2} onClick={() => setIndex(i => i - 1)}><ChevronLeft/> Previous</Button>
      <Button aria-pressed={auto} onClick={() => {if (isMobile) pendingGroupRef.current = slide?.id; setAuto(v => !v);}} className={auto ? "primary" : ""}>Auto-cycle {auto ? "on" : "off"}</Button>
      <Button disabled={slides.length < 2} onClick={() => setIndex(i => i + 1)}>Next <ChevronRight/></Button>
      <Button onClick={async () => {try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {setFullscreenError("Use your browser’s full-screen control to expand this display.");}}}><Expand/> Full screen</Button>
    </div>
    <p className="page-indicator">{slide && (auto && isMobile ? "Top 5" : `Page ${slide.page + 1} of ${slide.pages}`)} · {auto ? "Advancing every 6.5 seconds" : "Manual display"}</p>
    {fullscreenError && <p className="form-message">{fullscreenError}</p>}
  </section></PageShell>;
}
