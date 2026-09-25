import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Crown, Expand } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { eventStandings, formatScore, overallStandings } from "@/domain/ranking";
import type { Competition, Standing } from "@/domain/types";
import { BottomNav, Button, Empty, PageShell, scoreLabel } from "./shared";
import { ThemedSelect } from "./ThemedSelect";
import "./Standings.css";

type Mode = "overall" | "events" | "teams";
type DisplayRow = Standing & { result?: string };
const modes: Mode[] = ["overall", "events", "teams"];
// Rank arrows mark recent movement only; they clear after this long.
const MOVE_VISIBLE_MS = 20_000;
const podiumOrder = [1, 0, 2];

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
      const game = state.games?.find(g => g.eventId === event.id);
      let rows: DisplayRow[];
      if (event.kind === "knockout") {
        rows = game?.status === "complete"
          ? eventStandings(state, event.id).map(row => ({
              ...row,
              result: row.rank === 1 ? "Winner" : "Registered",
            }))
          : (game?.entrants ?? []).map(id => ({
              id,
              name: state.participants.find(p => p.id === id)?.name ?? "Entrant",
              rank: 0,
              points: 0,
              value: 0,
              eventsPlayed: 0,
              result: "Registered",
            }));
      } else {
        rows = eventStandings(state, event.id);
      }
      if (event.kind === "bracket" && bracket?.status !== "complete") {
        const entrants = bracket?.entrants ?? (event.team ? state.teams.filter(t => t.eventId === event.id).map(t => t.id) : []);
        rows = entrants.map(id => {
          const wins = bracket?.matches.filter(m => m.winnerId === id && !m.bye).length ?? 0;
          const eliminated = bracket?.matches.some(m => m.winnerId && m.winnerId !== id && [m.sideA, m.sideB].includes(id));
          return { id, name: state.participants.find(p => p.id === id)?.name ?? state.teams.find(t => t.id === id)?.name ?? "Entrant", rank: 0, points: 0, value: wins, eventsPlayed: wins, result: eliminated ? "Eliminated" : wins ? `${wins} win${wins === 1 ? "" : "s"}` : "Waiting" };
        });
      } else if (event.kind === "bracket") {
        rows = rows.map(row => ({ ...row, result: row.rank === 1 ? "Champion" : `Place ${row.rank}` }));
      } else if (event.kind === "count" || event.kind === "duration" || event.kind === "distance") {
        rows = rows.map(row => ({ ...row, result: `${formatScore(row.value, event)}${event.kind === "duration" ? "" : ` ${event.unit}`}` }));
      }
      return { id: event.id, title: event.name, detail: event.kind === "bracket" ? `${event.team ? "Team championship" : "Single elimination"}, ${bracket?.status === "complete" ? "final results" : bracket?.status === "active" ? "in progress" : "registration open"}` : event.kind === "knockout" ? (game?.status === "complete" ? "Winner recorded" : game?.status === "active" ? "Game in progress" : "Registration open") : scoreLabel(event), rows };
    };
    if (mode === "events" || mode === "teams") return state.events.filter(e => e.active && e.team === (mode === "teams")).map(eventGroup);
    return [{id: "overall", title: "Overall standings", detail: "Every individual event · Equal weight", rows: overallStandings(state) as DisplayRow[]}];
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
  // Compare each render's ranks with the last ones seen, so a rise or fall
  // shows as an arrow. Purely presentational; ranking itself is untouched.
  const lastRanks = useRef(new Map<string, number>());
  const [moves, setMoves] = useState(new Map<string, number>());
  useEffect(() => {
    const seen = new Map(lastRanks.current);
    const changed = new Map<string, number>();
    for (const group of groups) for (const row of group.rows) {
      if (!row.rank) continue;
      const key = `${group.id}:${row.id}`;
      const before = lastRanks.current.get(key);
      if (before && before !== row.rank) changed.set(key, before - row.rank);
      seen.set(key, row.rank);
    }
    lastRanks.current = seen;
    if (!changed.size) return;
    setMoves(changed);
    const timer = window.setTimeout(() => setMoves(new Map()), MOVE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [groups]);
  useEffect(() => {
    if (!auto || slides.length < 2) return;
    const timer = window.setInterval(() => setIndex(i => i + 1), 6500);
    return () => window.clearInterval(timer);
  }, [auto, slides.length]);
  const podium = slide && slide.page === 0 ? slide.rows.filter(row => row.rank > 0 && row.rank <= 3).slice(0, 3) : [];
  const listRows = slide ? slide.rows.filter(row => !podium.includes(row)) : [];
  const move = (row: DisplayRow) => slide ? moves.get(`${slide.id}:${row.id}`) ?? 0 : 0;
  const score = (row: DisplayRow) => row.result ?? `${Number(row.points.toFixed(2))} PTS`;
  return <PageShell bare><section className="presentation">
    <div className="stand-tabs">{modes.map(m => <button key={m} aria-pressed={mode === m} className={mode === m ? "active" : ""} onClick={() => {setMode(m); setIndex(0);}}>{m}</button>)}</div>
    <div className="stand-title">
      <div>
        <h1>{slide?.title ?? "Standings"}</h1>
        <p className="stand-subtitle">{slide?.detail}</p>
      </div>
      <p className={`live ${snapshot.connected ? "" : "offline"}`} role="status">{snapshot.connected ? <><span aria-hidden="true"/> Live</> : "Offline"}</p>
      {groups.length > 1 && <ThemedSelect className="standings-filter" label="Displayed competition" value={slide?.id ?? ""} onChange={value => setIndex(slides.findIndex(s => s.id === value))} options={groups.map(g => ({value:g.id,label:g.title}))} />}
    </div>
    {slide?.rows.length ? <>
      {podium.length > 0 && <ol className={`podium podium-${podium.length}`} aria-label="Top three">
        {podiumOrder.filter(i => podium[i]).map(i => { const row = podium[i]; return (
          <li key={row.id} className={`podium-step place-${i + 1}`}>
            {i === 0 && <Crown className="podium-crown" aria-hidden="true"/>}
            <Movement value={move(row)}/>
            <strong>{row.name}</strong>
            <span className="podium-score">{score(row)}</span>
            <b className="podium-block" aria-label={`Rank ${row.rank}`}>{row.rank}</b>
          </li>
        );})}
      </ol>}
      {listRows.length > 0 && <ol className="standing-rows">{listRows.map(row => <li className={`standing-row ${move(row) ? "moved" : ""}`} key={row.id}><b>{row.rank || "-"}</b><strong>{row.name}<Movement value={move(row)}/></strong><span>{score(row)}</span></li>)}</ol>}
    </> : <Empty text="Results will appear here when attempts are recorded."/>}
    <div className="presentation-controls">
      <Button disabled={slides.length < 2} onClick={() => setIndex(i => i - 1)}><ChevronLeft/> Previous</Button>
      <Button aria-pressed={auto} onClick={() => {if (isMobile) pendingGroupRef.current = slide?.id; setAuto(v => !v);}} className={auto ? "primary" : ""}>Auto-cycle {auto ? "on" : "off"}</Button>
      <Button disabled={slides.length < 2} onClick={() => setIndex(i => i + 1)}>Next <ChevronRight/></Button>
      <Button className="fullscreen-button" onClick={async () => {try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {setFullscreenError("Use your browser’s full-screen control to expand this display.");}}}><Expand/> Full screen</Button>
    </div>
    <p className="page-indicator">{slide && (auto && isMobile ? "Top 5" : `Page ${slide.page + 1} of ${slide.pages}`)} · {auto ? "Advancing every 6.5 seconds" : "Manual display"}</p>
    {fullscreenError && <p className="form-message">{fullscreenError}</p>}
  </section><BottomNav/></PageShell>;
}

function Movement({ value }: { value: number }) {
  if (!value) return null;
  const up = value > 0;
  return <span className={`movement ${up ? "up" : "down"}`} aria-label={`${up ? "Up" : "Down"} ${Math.abs(value)}`}>
    {up ? <ArrowUp aria-hidden="true"/> : <ArrowDown aria-hidden="true"/>}{Math.abs(value)}
  </span>;
}
