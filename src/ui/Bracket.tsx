import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Trophy } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import type { Competition, Match } from "@/domain/types";
import { canAddBracketEntrants } from "@/domain/ranking";
import { ParticipantPicker } from "./ParticipantPicker";
import { Button, PageShell, useMediaQuery, withDemo } from "./shared";
import "./BracketRoster.css";

export function Bracket({ event }: { event: Competition }) {
  const { snapshot, execute } = useConference();
  const bracket = snapshot.data.brackets.find((b) => b.eventId === event.id);
  const [winner, setWinner] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [bracketError, setBracketError] = useState("");
  const [rosterMessage, setRosterMessage] = useState("");
  const [openMemberKey, setOpenMemberKey] = useState<string | null>(null);
  const [focusedMemberKey, setFocusedMemberKey] = useState<string | null>(null);
  const [hoveredMemberKey, setHoveredMemberKey] = useState<string | null>(null);
  const teamNameInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const revisionRef = useRef<number | null>(null);
  const [mobileRound, setMobileRound] = useState(1);
  const names = (id: string | null) =>
    snapshot.data.teams.find((t) => t.id === id)?.name ??
    snapshot.data.participants.find((p) => p.id === id)?.name ??
    "TBD";
  const rounds = useMemo(
    () => (bracket ? [...new Set(bracket.matches.map((m) => m.round))].sort((a, b) => a - b) : []),
    [bracket],
  );
  const selectable = bracket?.matches.find((m) => {
    if (m.id !== selectedMatchId || !m.sideA || !m.sideB) return false;
    return !m.winnerId || Boolean(snapshot.identity?.admin);
  }) ?? (selectedMatchId ? undefined : bracket?.matches.find((m) => m.sideA && m.sideB && !m.winnerId));
  const finalRound = rounds[rounds.length - 1] ?? 1;
  // Show one round at a time whenever the full tree would need sideways
  // scrolling on a phone or tablet. Wide screens keep the whole board.
  const stacked = useMediaQuery(`(max-width: ${Math.max(760, Math.min(1000, rounds.length * 272 + 80))}px)`);
  const toPlay = (round: number) =>
    bracket?.matches.filter((m) => m.round === round && m.sideA && m.sideB && !m.winnerId).length ?? 0;
  const champion = bracket?.matches.find((m) => m.round === finalRound)?.winnerId;
  const matchLabel = (match: { round: number; position: number }) => `Round ${match.round}, match ${match.position + 1}`;
  const sideName = (match: Match, id: string | null, side: "A" | "B") => {
    if (id) return names(id);
    if (match.round > 1) return `Winner of match ${match.position * 2 + (side === "B" ? 2 : 1)}`;
    return match.bye ? "BYE" : "Waiting for entrant";
  };
  const roundLabel = (round: number) => {
    const remaining = finalRound - round;
    return remaining === 0 ? "FINAL" : remaining === 1 ? "SEMIFINALS" : remaining === 2 ? "QUARTERFINALS" : `ROUND ${round}`;
  };
  const matchState = (match: Match) => {
    if (match.bye) return "BYE";
    if (match.winnerId) return "COMPLETE";
    if (!match.sideA || !match.sideB) return "WAITING";
    return "READY";
  };
  useEffect(() => {
    const firstBracket = revisionRef.current === null && Boolean(bracket);
    const revisionChanged = Boolean(bracket && revisionRef.current !== null && revisionRef.current !== bracket.revision);
    if (revisionChanged && bracket) {
      setWinner("");
      setReason("");
      setBracketError("");
    }
    revisionRef.current = bracket?.revision ?? null;
    if (!bracket) {
      setSelectedMatchId("");
      setMobileRound(1);
      return;
    }
    const current = bracket.matches.find((match) => match.id === selectedMatchId);
    if (current && (!current.sideA || !current.sideB || (current.winnerId && !snapshot.identity?.admin))) {
      setSelectedMatchId("");
      setWinner("");
      setReason("");
      setBracketError("");
    }
    if (bracket && (firstBracket || revisionChanged || !rounds.includes(mobileRound))) {
      const pending = bracket.matches.find((match) => match.sideA && match.sideB && !match.winnerId);
      setMobileRound(pending?.round ?? finalRound);
    }
  }, [bracket, bracket?.revision, finalRound, mobileRound, rounds, selectedMatchId, snapshot.identity?.admin]);
  const saveWinner = async () => {
    if (saving || !bracket || !selectable || !winner) return;
    if (winner !== selectable.sideA && winner !== selectable.sideB) {
      setBracketError("Choose one of the two entrants in this match.");
      return;
    }
    if (selectable.winnerId && (!snapshot.identity?.admin || !reason.trim())) {
      setBracketError("Administrator corrections require a reason.");
      return;
    }
    setSaving(true);
    setBracketError("");
    setRosterMessage("");
    try {
      await execute({
        type: "matchWinner",
        bracketId: bracket.id,
        matchId: selectable.id,
        winnerId: winner,
        revision: bracket.revision,
        reason: reason.trim() || "Winner recorded",
      });
      setSelectedMatchId("");
      setWinner("");
      setReason("");
      setBracketError("");
    } catch {
      setBracketError(
        "Could not save the winner. The bracket may have changed.",
      );
    } finally {
      setSaving(false);
    }
  };
  const createTeam = async () => {
    if (
      saving ||
      !teamName.trim() ||
      (event.teamSize > 0 && !members.length) ||
      (event.teamSize > 0 && members.length !== event.teamSize)
    )
      { setBracketError(`Enter a team name${event.teamSize ? ` and select ${event.teamSize} members` : ''}.`); return; }
    const wasEditing = editingTeamId !== null;
    setSaving(true);
    setBracketError("");
    setRosterMessage("");
    try {
      await execute({
        type: "saveTeam",
        eventId: event.id,
        ...(editingTeamId ? { teamId: editingTeamId } : {}),
        name: teamName.trim(),
        memberIds: members,
      } as Parameters<typeof execute>[0]);
      setTeamName("");
      setMembers([]);
      setEditingTeamId(null);
      setRosterMessage(bracket && !wasEditing
        ? canAddBracketEntrants(bracket)
          ? "Team saved. An administrator can now choose Add to bracket below."
          : "Team saved outside the current bracket. Entrants are locked because a result has been recorded."
        : bracket
          ? "Team changes saved. Current matchups and recorded results remain preserved."
        : "Team saved and available as a bracket entrant.");
    } catch {
      setBracketError("Could not save that team.");
    } finally {
      setSaving(false);
    }
  };
  const editTeam = (team: (typeof snapshot.data.teams)[number]) => {
    setEditingTeamId(team.id);
    setTeamName(team.name);
    setMembers(team.memberIds);
    setBracketError("");
    setRosterMessage("");
    window.requestAnimationFrame(() => teamNameInput.current?.focus());
  };
  const cancelEditTeam = () => {
    setEditingTeamId(null);
    setTeamName("");
    setMembers([]);
    setRosterMessage("");
  };
  const addParticipant = async (name: string) => {
    setBracketError("");
    setRosterMessage("");
    try {
      await execute({ type: "addParticipant", name });
      setRosterMessage(`${name} added to the conference roster and selected.`);
      return true;
    } catch {
      setBracketError(`Could not add ${name}. Check your connection and try again.`);
      return false;
    }
  };
  const start = async () => {
    const entrants = event.team
      ? snapshot.data.teams
          .filter((t) => t.eventId === event.id)
          .map((t) => t.id)
      : members;
    if (!snapshot.identity?.admin || saving) return;
    if (entrants.length < 2) { setBracketError("Select at least two entrants before starting."); return; }
    setSaving(true);
    setBracketError("");
    try {
      await execute({
        type: "startBracket",
        eventId: event.id,
        entrantIds: entrants,
      });
    } catch {
      setBracketError(
        "Could not start the bracket. Check the entrants and try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  const eventTeams = snapshot.data.teams.filter((team) => team.eventId === event.id);
  const teamForId = (id: string | null) => id ? snapshot.data.teams.find((team) => team.id === id) : undefined;
  const memberNames = (team: (typeof eventTeams)[number]) =>
    team.memberIds
      .map((id) => snapshot.data.participants.find((participant) => participant.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  const addBracketTeam = async (teamId: string) => {
    if (saving || !bracket || !snapshot.identity?.admin || !canAddBracketEntrants(bracket)) return;
    setSaving(true);
    setBracketError("");
    setRosterMessage("");
    try {
      await execute({ type: "addBracketTeam", bracketId: bracket.id, teamId, revision: bracket.revision });
      setSelectedMatchId("");
      setWinner("");
      setReason("");
      setBracketError("");
      setRosterMessage("Team added to the current bracket. Matchups and byes were rearranged.");
    } catch {
      setBracketError("Could not add that team. The bracket may have changed or already have a result.");
    } finally {
      setSaving(false);
    }
  };
  const bracketBoard = bracket && (
    <section className={`bracket-workspace ${stacked ? "stacked" : ""}`} aria-labelledby="bracket-title">
      <div className="bracket-workspace-heading">
        <div>
          <h2 id="bracket-title">{bracket.status === "complete" ? "CHAMPIONSHIP COMPLETE" : "LIVE BRACKET"}</h2>
        </div>
        {champion && bracket.status === "complete" && <p className="bracket-champion"><Trophy aria-hidden="true" /> Champion: <strong>{names(champion)}</strong></p>}
      </div>
      <nav className="round-nav" aria-label="Bracket rounds">
        {rounds.map((round) => <button key={round} type="button" className={mobileRound === round ? "selected" : ""} aria-current={mobileRound === round ? "true" : undefined} onClick={() => setMobileRound(round)}>{roundLabel(round)}{toPlay(round) > 0 && <small>{toPlay(round)} to play</small>}</button>)}
      </nav>
      <p className="bracket-help">{bracket.status === "complete" ? snapshot.identity?.admin ? "Select a completed match to correct its result." : "Follow each round to see the path to the championship." : "Select a ready match to record its winner."}</p>
      <div className="bracket-board" role="region" tabIndex={0} aria-label="Single elimination bracket" style={{ "--round-count": rounds.length, "--tree-rows": 2 ** (rounds.length), "--tree-end": 2 ** (rounds.length) + 2 } as CSSProperties}>
        {rounds.map((round) => (
          <section className={`round ${mobileRound === round ? "mobile-active" : ""}`} key={round} aria-labelledby={`round-${round}`}>
            <h3 id={`round-${round}`}>{roundLabel(round)}</h3>
            {bracket.matches.filter((m) => m.round === round).sort((a, b) => a.position - b.position).map((m) => {
              const state = matchState(m);
              const isSelectable = Boolean(m.sideA && m.sideB && (!m.winnerId || snapshot.identity?.admin));
              const sideAName = sideName(m, m.sideA, "A");
              const sideBName = sideName(m, m.sideB, "B");
              const selectMatch = () => {
                if (!isSelectable) return;
                setSelectedMatchId(m.id); setWinner(m.winnerId ?? ""); setReason(""); setBracketError(""); setMobileRound(m.round);
                window.requestAnimationFrame(() => { editorRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" }); editorRef.current?.focus({ preventScroll: true }); });
              };
              const renderSide = (id: string | null, sideNameValue: string, side: "A" | "B") => {
                const team = teamForId(id);
                const memberLabel = team ? `View members of ${team.name}` : "";
                const memberKey = `${m.id}-${side}`;
                const memberOpen = openMemberKey === memberKey || focusedMemberKey === memberKey || hoveredMemberKey === memberKey;
                return <div className={m.winnerId !== null && m.winnerId === id ? "winner" : ""}>
                  <span className="match-side-name">{team ? <span className="team-member-trigger-wrap" onMouseEnter={() => setHoveredMemberKey(memberKey)} onMouseLeave={() => setHoveredMemberKey((current) => current === memberKey ? null : current)}>
                    <button type="button" className="team-member-trigger" aria-label={memberLabel} aria-describedby={`members-${memberKey}`} aria-expanded={memberOpen} onClick={(event) => { event.stopPropagation(); if (openMemberKey === memberKey) { setOpenMemberKey(null); setFocusedMemberKey(null); setHoveredMemberKey(null); } else { setOpenMemberKey(memberKey); } }} onFocus={() => setFocusedMemberKey(memberKey)} onBlur={() => { setFocusedMemberKey((current) => current === memberKey ? null : current); setOpenMemberKey((current) => current === memberKey ? null : current); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpenMemberKey(null); setFocusedMemberKey(null); setHoveredMemberKey(null); } }}>{sideNameValue}</button>
                    <span id={`members-${memberKey}`} className={`team-members-tooltip ${memberOpen ? "open" : ""}`} role="tooltip">{memberNames(team) || "No members listed"}</span>
                  </span> : sideNameValue}</span>
                  {m.winnerId !== null && m.winnerId === id && <Check aria-hidden="true" />}
                </div>;
              };
              return <div className="match-slot" key={m.id} style={{ gridRow: `${m.position * 2 ** m.round + 2} / span ${2 ** m.round}` }}><article className={`match match-${state.toLowerCase()} ${selectable?.id === m.id ? "selected" : ""}`} key={m.id}>
                {isSelectable && <button type="button" className="match-select" aria-label={`${matchLabel(m)}: ${sideAName} versus ${sideBName}. ${state}`} aria-pressed={selectable?.id === m.id} onClick={selectMatch} />}
                <div className="match-content">
                  <div className="match-meta"><span>{matchLabel(m)}</span><strong>{state}</strong></div>
                  {renderSide(m.sideA, sideAName, "A")}
                  {renderSide(m.sideB, sideBName, "B")}
                </div>
              </article></div>;
            })}
          </section>
        ))}
      </div>
    </section>
  );
  return (
    <PageShell>
      <section className="bracket-page">
        <header className="bracket-header">
          <Link className="back" to={withDemo("/events")}>
            <ArrowLeft /> Events
          </Link>
          <h1>{event.name}</h1>
          <div className="pills">
            <span>
              {event.team
                ? event.teamSize
                  ? `Teams of ${event.teamSize}`
                  : "Freeform teams"
                : "Individual"}
            </span>
            <span>Single elimination</span>
          </div>
          {event.instructions.trim() && (
            <p className="event-instructions">{event.instructions}</p>
          )}
          <p className="event-instructions">
            {event.team ? "Team championship. Separate from individual points." : "Individual championship. Counts toward overall points."}
          </p>
        </header>
        <div className={`bracket-play ${!bracket ? "bracket-not-started" : ""}`}>
          {bracketBoard}
        <aside className="winner-panel" ref={editorRef} aria-labelledby="bracket-editor-title" aria-live="polite" tabIndex={-1}>
          {selectable ? (
            <>
              <h2 id="bracket-editor-title">
                {selectable.winnerId ? "CORRECT WINNER" : "RECORD RESULT"}
              </h2>
              <p className="editor-context">{matchLabel(selectable)} · {roundLabel(selectable.round)}</p>
              {selectable.winnerId && (
                <p className="event-instructions">
                  Changing this result can invalidate downstream matches.
                  Include a reason.
                </p>
              )}
              <p>Who won?</p>
              <form onSubmit={(formEvent) => { formEvent.preventDefault(); void saveWinner(); }}>
              {[selectable.sideA, selectable.sideB].map(
                (id) =>
                  id && (
                    <button
                      key={id}
                      type="button"
                      className={`winner-choice ${winner === id ? "selected" : ""}`}
                      aria-pressed={winner === id}
                      onClick={() => setWinner(id)}
                    >
                      {names(id)}
                    </button>
                  ),
              )}
              {snapshot.identity?.admin && selectable.winnerId && (
                <div className="bracket-field">
                  <label htmlFor="bracket-correction-reason">Correction reason</label>
                  <input
                    id="bracket-correction-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain why the winner is changing"
                  />
                </div>
              )}
              <Button
                type="submit"
                className="primary"
                disabled={
                  !winner || saving || (!!selectable.winnerId && !reason.trim())
                }
              >
                {saving ? "Saving…" : "Save winner"}
              </Button>
              </form>
              {bracketError && <p className="form-message" role="alert">{bracketError}</p>}
            </>
          ) : (
            <>
              <Trophy />
              <h2 id="bracket-editor-title">
                {bracket?.status === "complete"
                  ? "BRACKET COMPLETE"
                  : "WAITING FOR RESULT"}
              </h2>
              <p>
                  {bracket?.status === "complete"
                  ? `The champion is ${champion ? names(champion) : "decided"}.`
                  : "Choose a match to record its winner."}
              </p>
            </>
          )}
        </aside>
        </div>
          <details className="bracket-roster-details" open={!bracket}>
            <summary>Roster and entrants</summary>
          <section className="bracket-roster" aria-labelledby="bracket-roster-title">
            <div className="bracket-roster-heading">
              <div>
                <h2 id="bracket-roster-title">MANAGE {event.team ? "TEAMS" : "PARTICIPANTS"}</h2>
              </div>
              {bracket && <p className="roster-note">{event.team ? "You can create or edit teams here. Add a registered team while the bracket is open; matchups and byes will be rearranged. After the first result, the bracket is locked." : "This bracket has started. Matchups and recorded results are preserved."}</p>}
            </div>
            {event.team && (
              <div className="team-registration">
                <h3>{editingTeamId ? "EDIT TEAM" : "REGISTER A TEAM"}</h3>
                <p className="event-instructions">{event.teamSize > 0 ? `Select exactly ${event.teamSize} members.` : "Select any members, or leave the roster empty."}</p>
                <form onSubmit={(formEvent) => { formEvent.preventDefault(); void createTeam(); }}>
                  <div className="bracket-field">
                    <label htmlFor="bracket-team-name">Team name</label>
                    <input ref={teamNameInput} id="bracket-team-name" placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
                  </div>
                  <ParticipantPicker id="bracket-team-members" label="Team members" participants={snapshot.data.participants} selected={members} onChange={setMembers} max={event.teamSize} onCreate={addParticipant} />
                  <div className="roster-actions">
                    <Button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : editingTeamId ? "Save changes" : "Save team"}</Button>
                    {editingTeamId && <Button type="button" onClick={cancelEditTeam} disabled={saving}>Cancel</Button>}
                  </div>
                </form>
              </div>
            )}
            {!bracket && (
              <div className="bracket-start-roster">
                <h3>SELECT ENTRANTS</h3>
                <p>{event.team ? "Saved teams become entrants when you start this bracket." : "Select participants for this bracket."}</p>
                {!event.team && <ParticipantPicker id="bracket-entrants" label="Entrants" participants={snapshot.data.participants} selected={members} onChange={setMembers} onCreate={addParticipant} />}
              </div>
            )}
            {event.team && <div className="registered-teams">
              <h3>REGISTERED TEAMS</h3>
              {eventTeams.length === 0 && <p className="roster-note">No teams registered yet.</p>}
              {eventTeams.map((team) => {
                const inBracket = bracket?.entrants.includes(team.id) ?? false;
                const canAdd = Boolean(bracket && !inBracket && snapshot.identity?.admin && canAddBracketEntrants(bracket));
                return <article className="registered-team" key={team.id}><div><strong>{team.name}</strong><span>{memberNames(team) || "No members listed"}</span></div><span className={`team-status ${inBracket ? "in-bracket" : "out-bracket"}`}>{inBracket ? "In current bracket" : "Not in current bracket"}</span>{snapshot.identity?.admin && <div className="registered-team-actions"><Button type="button" onClick={() => editTeam(team)}>Edit team</Button>{canAdd && <Button type="button" className="primary" disabled={saving} onClick={() => void addBracketTeam(team.id)}>Add to bracket</Button>}</div>}</article>;
              })}
            </div>}
            {!bracket && <div className="bracket-start"><h3>READY TO START?</h3><p>Add at least two {event.team ? "teams" : "participants"}, then create the bracket.</p>{snapshot.identity?.admin && <Button type="button" className="primary" disabled={saving} onClick={start}>Start bracket</Button>}</div>}
            {bracketError && <p className="form-message" role="alert">{bracketError}</p>}
            {rosterMessage && <p className="form-message roster-success" role="status">{rosterMessage}</p>}
          </section>
          </details>

      </section>
    </PageShell>
  );
}
