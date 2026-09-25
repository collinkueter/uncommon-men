import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Play, Search, Square, UserPlus } from "lucide-react";
import { useConference } from "@/lib/ConferenceContext";
import { formatScore, getBestAttempt, normalizeName } from "@/domain/ranking";
import type { Competition } from "@/domain/types";
import {
  Button,
  Empty,
  PageShell,
  RequireIdentity,
  formatDuration,
  parseDuration,
  withDemo,
  nowId,
  scoreLabel,
} from "./shared";
import { Bracket } from "./Bracket";
import { Knockout } from "./Knockout";
import { AttemptList, getAttemptsForEventParticipant, participantIdForName } from "./AttemptList";
import { HowToPlay } from "./HowToPlay";
import "./EntryForms.css";

export function ScoreEvent() {
  const { eventId = "" } = useParams();
  const { snapshot } = useConference();
  const event = snapshot.data.events.find((e) => e.id === eventId);
  if (snapshot.loading)
    return (
      <PageShell>
        <div className="route-pending" aria-busy="true" aria-label="Loading event" />
      </PageShell>
    );
  if (!event || !event.active)
    return (
      <PageShell>
        <Empty text="That event is unavailable." />
      </PageShell>
    );
  if (event.kind === "bracket")
    return (
      <RequireIdentity>
        <Bracket key={event.id} event={event} />
      </RequireIdentity>
    );
  if (event.kind === "knockout")
    return (
      <RequireIdentity>
        <Knockout key={event.id} event={event} />
      </RequireIdentity>
    );
  return (
    <RequireIdentity>
      <ScoreForm key={event.id} event={event} />
    </RequireIdentity>
  );
}
function ScoreForm({ event }: { event: Competition }) {
  const { snapshot, execute } = useConference();
  const timerKey = `uncommon-men:timer:${snapshot.mode}:${snapshot.identity?.uid}:${event.id}`;
  const savedTimer = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem(timerKey) ?? "{}") as {
        elapsed?: number;
        running?: boolean;
        startedAt?: number;
        name?: string;
        participantId?: string;
        recorderName?: string;
      };
    } catch {
      return {};
    }
  }, [timerKey]);
  // An idle draft can outlive a profile change because the timer is keyed by UID.
  // Keep active work intact, while letting a newly selected profile start cleanly.
  const activeSavedTimer = Boolean(savedTimer.running || savedTimer.elapsed);
  const staleIdleOwnDraft =
    !activeSavedTimer &&
    Boolean(savedTimer.recorderName) &&
    normalizeName(savedTimer.recorderName ?? "") !==
      normalizeName(snapshot.identity?.name ?? "") &&
    normalizeName(savedTimer.name ?? "") === normalizeName(savedTimer.recorderName ?? "");
  const restoreSavedCompetitor =
    !staleIdleOwnDraft;
  const [name, setName] = useState(
    restoreSavedCompetitor
      ? savedTimer.name ?? snapshot.identity?.name ?? ""
      : snapshot.identity?.name ?? "",
  );
  const [participantId, setParticipantId] = useState(
    restoreSavedCompetitor
      ? savedTimer.participantId ?? snapshot.identity?.participantId
      : snapshot.identity?.participantId,
  );
  const [mode, setMode] = useState<"manual" | "timer">(
    event.kind === "duration" ? "timer" : "manual",
  );
  const [manual, setManual] = useState("");
  const [elapsed, setElapsed] = useState(() => savedTimer.elapsed ?? 0);
  const [running, setRunning] = useState(() => savedTimer.running ?? false);
  const [startedAt, setStartedAt] = useState<number | null>(
    () => savedTimer.startedAt ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  const submitted = useRef<string | null>(null);
  const requestId = useRef(nowId());
  const competitorInput = useRef<HTMLInputElement>(null);
  const competitorId = `competitor-${event.id}`;
  const manualValueId = `manual-value-${event.id}`;
  const participants = snapshot.data.participants;
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Until the user types, the list shows everyone so they can switch competitor.
  const matches = useMemo(() => {
    const query = typed ? normalizeName(name) : "";
    const scored = participants
      .map((p) => ({ p, candidate: p.normalizedName || normalizeName(p.name) }))
      .filter(({ candidate }) => !query || candidate.includes(query))
      .sort((a, b) => Number(b.candidate.startsWith(query)) - Number(a.candidate.startsWith(query)) || a.p.name.localeCompare(b.p.name));
    return scored.map(({ p }) => p).slice(0, 50);
  }, [participants, name, typed]);
  const exactMatch = participants.some((p) => (p.normalizedName || normalizeName(p.name)) === normalizeName(name));
  const showNew = typed && Boolean(name.trim()) && !exactMatch;
  const optionCount = matches.length + (showNew ? 1 : 0);
  const listOpen = suggestOpen && optionCount > 0;
  const listId = `${competitorId}-list`;
  const optionId = (index: number) => `${listId}-${index}`;
  const chooseParticipant = (p: (typeof participants)[number]) => {
    setName(p.name);
    setParticipantId(p.id);
    setSuggestOpen(false);
    setTyped(false);
    setActiveIndex(-1);
  };
  const keepTypedName = () => {
    setName(name.trim());
    setSuggestOpen(false);
    setTyped(false);
    setActiveIndex(-1);
  };
  useEffect(() => {
    if (!running || !startedAt) return;
    const id = window.setInterval(
      () => setElapsed((Date.now() - startedAt) / 1000),
      33,
    );
    return () => clearInterval(id);
  }, [running, startedAt]);
  // While running, startedAt restores the timer, so skip per-tick storage writes.
  const persistedElapsed = running ? null : elapsed;
  useEffect(() => {
    sessionStorage.setItem(
      timerKey,
      JSON.stringify({
        elapsed,
        running,
        startedAt,
        name,
        participantId,
        recorderName: snapshot.identity?.name,
      }),
    );
  }, [persistedElapsed, running, startedAt, timerKey, name, participantId, snapshot.identity?.name]);
  // Results are shown to the hundredth, so store them that way too; otherwise
  // two displayed-equal times would rank differently on hidden milliseconds.
  const current =
    mode === "timer"
      ? Math.round(elapsed * 100) / 100
      : event.kind === "duration"
        ? parseDuration(manual)
        : Number(manual.trim().replace(",", "."));
  const data = snapshot.data;
  const selectedParticipantId = useMemo(
    () => participantId ?? participantIdForName(data, name),
    [participantId, data, name],
  );
  const best = useMemo(
    () =>
      selectedParticipantId
        ? getBestAttempt(data, event.id, selectedParticipantId)
        : undefined,
    [data, event.id, selectedParticipantId],
  );
  const attempts = useMemo(
    () =>
      getAttemptsForEventParticipant(data, event.id, selectedParticipantId, name),
    [data, event.id, selectedParticipantId, name],
  );
  const submit = async () => {
    const manualBlank = mode === "manual" && manual.trim() === "";
    const invalid =
      manualBlank ||
      !Number.isFinite(current) ||
      (event.kind === "count"
        ? current < 0 || !Number.isInteger(current)
        : current <= 0);
    if (running) {
      setMessage("Stop the timer before saving.");
      return;
    }
    if (!name.trim() || invalid || saving) {
      setMessage(
        event.kind === "count"
          ? "Enter a whole-number count of zero or greater."
          : "Enter a valid result before saving.",
      );
      return;
    }
    const key = `${event.id}:${normalizeName(name)}:${current}`;
    if (submitted.current === key) {
      setMessage(
        "That result was already saved. Reset the timer or change the result to record another attempt.",
      );
      return;
    }
    setSaving(true);
    try {
      await execute({
        type: "attempt",
        eventId: event.id,
        name: name.trim(),
        participantId,
        value: current,
        requestId: requestId.current,
      });
      submitted.current = key;
      requestId.current = nowId();
      setMessage("Attempt saved. Your best result counts.");
      setManual("");
      setElapsed(0);
    } catch {
      setMessage("Unable to save that attempt. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <PageShell>
      <form
        className="content scoring"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Link className="back" to={withDemo("/events")}>
          <ArrowLeft /> Events
        </Link>
        <h1>{event.name}</h1>
        <div className="pills scoring-pills">
          <span>{scoreLabel(event)}</span>
        </div>
        <HowToPlay instructions={event.instructions} />
        <div className="entry-field competitor-field">
          <label htmlFor={competitorId}>Competing</label>
          <div className={`competitor ${listOpen ? "open" : ""}`}>
            <input
              id={competitorId}
              ref={competitorInput}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={listOpen}
              aria-controls={listId}
              aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
              aria-describedby="competitor-recorder"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search or type a name"
              value={name}
              onFocus={(e) => {
                e.currentTarget.select();
                setTyped(false);
                setActiveIndex(-1);
                setSuggestOpen(true);
              }}
              onClick={() => setSuggestOpen(true)}
              onBlur={() => setSuggestOpen(false)}
              onChange={(e) => {
                setName(e.target.value);
                setParticipantId(undefined);
                setTyped(true);
                setActiveIndex(e.target.value.trim() ? 0 : -1);
                setSuggestOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!listOpen) { setSuggestOpen(true); return; }
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setActiveIndex((current) => (current + step + optionCount) % optionCount);
                } else if (e.key === "Enter" && listOpen) {
                  e.preventDefault();
                  if (activeIndex >= 0 && activeIndex < matches.length) chooseParticipant(matches[activeIndex]);
                  else keepTypedName();
                } else if (e.key === "Escape" && listOpen) {
                  e.preventDefault();
                  setSuggestOpen(false);
                }
              }}
            />
            {listOpen && (
              <ul className="competitor-suggestions" id={listId} role="listbox" aria-label="Competitors">
                {matches.map((p, index) => (
                  <li
                    key={p.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`${index === activeIndex ? "active" : ""} ${p.id === participantId ? "current" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseParticipant(p)}
                  >
                    <Search aria-hidden="true" />
                    <span>{p.name}</span>
                    {p.id === participantId && <Check aria-hidden="true" className="current-mark" />}
                  </li>
                ))}
                {showNew && (
                  <li
                    id={optionId(matches.length)}
                    role="option"
                    aria-selected={activeIndex === matches.length}
                    className={`new-competitor ${activeIndex === matches.length ? "active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(matches.length)}
                    onClick={keepTypedName}
                  >
                    <UserPlus aria-hidden="true" />
                    <span>New competitor: <strong>{name.trim()}</strong></span>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
        <p className="recorded" id="competitor-recorder">
          Recorded by {snapshot.identity?.name}
        </p>
        {event.kind === "duration" && (
          <div className="segment" role="group" aria-label="Result entry mode">
            <button
              type="button"
              className={mode === "timer" ? "active" : ""}
              aria-pressed={mode === "timer"}
              onClick={() => setMode("timer")}
            >
              Stopwatch
            </button>
            <button
              type="button"
              className={mode === "manual" ? "active" : ""}
              aria-pressed={mode === "manual"}
              onClick={() => setMode("manual")}
            >
              Manual entry
            </button>
          </div>
        )}
        {mode === "timer" ? (
          <div className="timer">
            <output role="timer" aria-live="off">
              {formatDuration(elapsed)}
            </output>
            <small>
              {running
                ? "RUNNING"
                : elapsed
                  ? "STOPPED. Review before saving."
                  : "minutes : seconds . hundredths"}
            </small>
            {(running || elapsed === 0) && <Button
              type="button"
              onClick={() => {
                if (running) {
                  if (startedAt) setElapsed((Date.now() - startedAt) / 1000);
                  setRunning(false);
                } else {
                  setStartedAt(Date.now() - elapsed * 1000);
                  setRunning(true);
                }
              }}
              className={running ? "danger" : "primary"}
            >
              {running ? (
                <>
                  <Square /> Stop timer
                </>
              ) : (
                <>
                  <Play /> Start timer
                </>
              )}
            </Button>}
            <Button
              type="button"
              onClick={() => {
                setRunning(false);
                setElapsed(0);
                setStartedAt(null);
                sessionStorage.removeItem(timerKey);
                submitted.current = null;
              }}
              disabled={!elapsed}
            >
              Reset timer
            </Button>
          </div>
        ) : (
          <div className="entry-field value-input">
            <label htmlFor={manualValueId}>
              {event.kind === "duration"
              ? "Time (mm:ss.ss)"
              : `Result (${event.unit})`}
            </label>
            <input
              id={manualValueId}
              inputMode="decimal"
              value={manual}
              onChange={(e) => {
                setManual(e.target.value);
                submitted.current = null;
              }}
              placeholder={event.kind === "duration" ? "02:18.40" : "0"}
            />
          </div>
        )}
        {best && (
          <p className="previous">
            Previous best <strong>{formatScore(best.value, event)}</strong>
          </p>
        )}
        <Button
          className="primary save"
          type="submit"
          disabled={saving || running}
        >
          {saving ? "Saving…" : "Save attempt"}
        </Button>
        {message && <p key={message} className={`form-message ${message.startsWith("Attempt saved") ? "saved" : ""}`} role="status">{message}</p>}
        <button
          type="button"
          className="underline attempt-toggle"
          aria-expanded={attemptsOpen}
          aria-controls={`attempt-history-${event.id}`}
          onClick={() => setAttemptsOpen((open) => !open)}
        >
          {attemptsOpen ? "Hide attempts" : "View attempts"}
        </button>
        {attemptsOpen && (
          <section
            id={`attempt-history-${event.id}`}
            className="inline-attempt-history"
            aria-live="polite"
          >
            <h2>Attempts for {name.trim() || "this competitor"}</h2>
            <p className="attempt-history-event">{event.name}</p>
            <AttemptList
              state={snapshot.data}
              attempts={attempts}
              emptyText="No attempts recorded for this competitor and event yet."
            />
          </section>
        )}
      </form>
    </PageShell>
  );
}
