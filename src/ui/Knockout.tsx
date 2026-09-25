import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Play } from "lucide-react";
import { Link } from "react-router-dom";
import type { Competition } from "@/domain/types";
import { useConference } from "@/lib/ConferenceContext";
import { ParticipantPicker } from "./ParticipantPicker";
import { Button, Empty, PageShell, withDemo } from "./shared";
import "./Knockout.css";

export function Knockout({ event }: { event: Competition }) {
  const { snapshot, execute } = useConference();
  const game = snapshot.data.games?.find((item) => item.eventId === event.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [winner, setWinner] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (game) setSelected((current) => current.filter((id) => !game.entrants.includes(id)));
  }, [game]);
  useEffect(() => {
    setWinner("");
    setReason("");
  }, [game?.revision]);

  const names = useMemo(() => new Map(snapshot.data.participants.map((p) => [p.id, p.name])), [snapshot.data.participants]);
  const addParticipant = async (name: string) => {
    try {
      await execute({ type: "addParticipant", name });
      return true;
    } catch {
      setMessage("Could not add that participant. Try again.");
      return false;
    }
  };
  const join = async () => {
    const pending = selected.filter((id) => !game?.entrants.includes(id));
    if (!pending.length || saving) return;
    setSaving(true);
    setMessage("");
    let joined = 0;
    try {
      for (const participantId of pending) {
        await execute({ type: "joinGame", eventId: event.id, participantId });
        setSelected((current) => current.filter((id) => id !== participantId));
        joined += 1;
      }
      setMessage(`${joined} entrant${joined === 1 ? "" : "s"} signed up.`);
    } catch {
      setMessage(joined ? `${joined} entrant${joined === 1 ? "" : "s"} signed up. One or more could not be saved.` : "Could not save that signup. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const start = async () => {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      await execute({ type: "startGame", eventId: event.id });
      setMessage("Game started.");
    } catch {
      setMessage("A game needs at least two saved entrants before it can start.");
    } finally {
      setSaving(false);
    }
  };
  const saveWinner = async () => {
    if (!game || !winner || saving || (game.status === "complete" && (!reason.trim() || winner === game.winnerId))) return;
    setSaving(true);
    setMessage("");
    try {
      await execute({
        type: "gameWinner",
        eventId: event.id,
        winnerId: winner,
        revision: game.revision,
        ...(game.status === "complete" ? { reason: reason.trim() } : {}),
      });
      setReason("");
      setMessage("Winner saved.");
    } catch {
      setMessage("Could not save the winner. Refresh and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!event.active) return <Empty text="That event is unavailable." />;
  const entrants = game?.entrants ?? [];
  const completedName = game?.winnerId ? names.get(game.winnerId) ?? "Unknown entrant" : "";
  return (
    <PageShell>
      <section className="content knockout-page">
        <Link className="back" to={withDemo("/events")}><ArrowLeft /> Events</Link>
        <h1>{event.name}</h1>
        <div className="pills scoring-pills"><span>Single-winner game</span></div>
        {event.instructions.trim() && <p className="event-instructions">{event.instructions}</p>}

        {(!game || game.status === "registration") && (
          <section className="knockout-panel" aria-labelledby="knockout-signup-title">
            <h2 id="knockout-signup-title">SIGN UP</h2>
            <p>Choose a person to add to the saved entrant roster. Registration closes when an administrator starts the game.</p>
            <ParticipantPicker
              id={`game-participant-${event.id}`}
              label="Participant"
              participants={snapshot.data.participants.filter((participant) => !entrants.includes(participant.id))}
              selected={selected}
              max={0}
              onChange={setSelected}
              onCreate={addParticipant}
            />
            <Button className="primary" type="button" disabled={!selected.length || saving} onClick={() => void join()}>
              {saving ? "Saving…" : "Join game"}
            </Button>
            {entrants.length > 0 && <EntrantRoster entrants={entrants} names={names} />}
            {snapshot.identity?.admin && <Button type="button" className="knockout-start" disabled={entrants.length < 2 || saving} onClick={() => void start()}><Play /> Start game</Button>}
          </section>
        )}

        {game?.status === "active" && (
          <section className="knockout-panel" aria-labelledby="knockout-winner-title">
            <h2 id="knockout-winner-title">RECORD WINNER</h2>
            <p>Choose exactly one winner from the saved entrant roster.</p>
            <WinnerChoices entrants={entrants} names={names} winner={winner} onChange={setWinner} />
            <Button className="primary" type="button" disabled={!winner || saving} onClick={() => void saveWinner()}><CheckCircle2 /> {saving ? "Saving…" : "Save winner"}</Button>
            <EntrantRoster entrants={entrants} names={names} />
          </section>
        )}

        {game?.status === "complete" && (
          <section className="knockout-panel" aria-labelledby="knockout-complete-title">
            <h2 id="knockout-complete-title">GAME COMPLETE</h2>
            <p className="knockout-winner"><CheckCircle2 /> Winner: <strong>{completedName}</strong></p>
            <EntrantRoster entrants={entrants} names={names} />
            {snapshot.identity?.admin && (
              <div className="knockout-correction">
                <h3>Correct winner</h3>
                <WinnerChoices entrants={entrants} names={names} winner={winner} onChange={setWinner} />
                <label>Reason for correction<textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the correction" /></label>
                <Button className="primary" type="button" disabled={!winner || winner === game.winnerId || !reason.trim() || saving} onClick={() => void saveWinner()}>{saving ? "Saving…" : "Save correction"}</Button>
              </div>
            )}
          </section>
        )}
        {message && <p className="form-message" role="status">{message}</p>}
      </section>
    </PageShell>
  );
}

function EntrantRoster({ entrants, names }: { entrants: string[]; names: Map<string, string> }) {
  return <div className="knockout-roster"><h3>REGISTERED ENTRANTS</h3><ul>{entrants.map((id) => <li key={id}>{names.get(id) ?? "Unknown entrant"}</li>)}</ul></div>;
}

function WinnerChoices({ entrants, names, winner, onChange }: { entrants: string[]; names: Map<string, string>; winner: string; onChange: (id: string) => void }) {
  return <fieldset className="winner-choices"><legend>Winner</legend>{entrants.map((id) => <label key={id}><input type="radio" name="game-winner" value={id} checked={winner === id} onChange={() => onChange(id)} />{names.get(id) ?? "Unknown entrant"}</label>)}</fieldset>;
}
