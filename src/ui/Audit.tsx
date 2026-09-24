import { FileText } from "lucide-react";
import { formatScore } from "@/domain/ranking";
import type { AuditEntry, Competition, ConferenceState } from "@/domain/types";
import { useConference } from "@/lib/ConferenceContext";
import "./audit.css";

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;

const text = (value: unknown, fallback = "Unknown") =>
  typeof value === "string" && value.trim() ? value : fallback;

const numberText = (value: unknown, fallback = "?") =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;

const score = (value: unknown, event?: Competition) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return text(value);
  if (!event) return String(value);
  const formatted = formatScore(value, event);
  return event.kind === "duration" ? formatted : `${formatted} ${event.unit}`;
};

const json = (value: unknown) => {
  try {
    const result = JSON.stringify(value, null, 2);
    return result === undefined ? String(value) : result;
  } catch {
    return String(value);
  }
};

const entityName = (state: ConferenceState, entityType: string, id: string) => {
  if (entityType === "events" || entityType === "event")
    return state.events.find((item) => item.id === id)?.name ?? id;
  if (entityType === "categories" || entityType === "category")
    return state.categories.find((item) => item.id === id)?.name ?? id;
  if (entityType === "participants" || entityType === "participant")
    return state.participants.find((item) => item.id === id)?.name ?? id;
  if (entityType === "teams" || entityType === "team")
    return state.teams.find((item) => item.id === id)?.name ?? id;
  return id;
};

const participantName = (state: ConferenceState, id: unknown) =>
  typeof id === "string"
    ? state.participants.find((item) => item.id === id)?.name ?? id
    : "Unknown participant";

const eventFor = (
  state: ConferenceState,
  before: RecordValue | null,
  after: RecordValue | null,
  entityId?: string,
) => {
  let id = text(after?.eventId ?? before?.eventId, "");
  if (!id && entityId) {
    id = state.attempts.find((item) => item.id === entityId)?.eventId ??
      state.brackets.find((item) => item.id === entityId)?.eventId ?? "";
  }
  return state.events.find((item) => item.id === id);
};

const winnerName = (state: ConferenceState, id: unknown) => {
  if (typeof id !== "string") return "no winner";
  return state.teams.find((item) => item.id === id)?.name ?? participantName(state, id);
};

const bracketChange = (
  state: ConferenceState,
  before: RecordValue | null,
  after: RecordValue | null,
  entityId?: string,
) => {
  const event = eventFor(state, before, after, entityId);
  const beforeMatches = Array.isArray(before?.matches) ? before.matches : [];
  const afterMatches = Array.isArray(after?.matches) ? after.matches : [];
  for (const candidate of afterMatches) {
    const next = asRecord(candidate);
    if (!next) continue;
    const previous = beforeMatches
      .map(asRecord)
      .find((item) => item?.id === next.id);
    if (next.winnerId !== previous?.winnerId) {
      const oldWinner = winnerName(state, previous?.winnerId);
      const newWinner = winnerName(state, next.winnerId);
      if (!previous?.winnerId && next.winnerId)
        return `${event?.name ?? "Bracket"} · ${newWinner} won round ${numberText(next.round)}, match ${typeof next.position === "number" ? next.position + 1 : "?"}`;
      return `${event?.name ?? "Bracket"} · ${oldWinner} → ${newWinner} in round ${numberText(next.round)}, match ${typeof next.position === "number" ? next.position + 1 : "?"}`;
    }
  }
  return `${event?.name ?? "Bracket"} bracket updated`;
};

export function describeAuditEntry(entry: AuditEntry, state: ConferenceState): string {
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const event = eventFor(state, before, after, entry.entityId);
  switch (entry.action) {
    case "attempt":
    case "correctAttempt": {
      const attempt = state.attempts.find((item) => item.id === entry.entityId);
      const person = participantName(
        state,
        after?.participantId ?? before?.participantId ?? attempt?.participantId,
      );
      const from = before?.value === undefined ? null : score(before.value, event);
      const to = after?.value === undefined ? null : score(after.value, event);
      const value = from && to && from !== to ? `${from} → ${to}` : to ?? from ?? "score recorded";
      const invalidated = before?.valid === true && after?.valid === false;
      const restored = before?.valid === false && after?.valid === true;
      const validity = invalidated || restored
        ? invalidated ? " · invalidated" : " · restored"
        : after?.valid === false ? " · invalid" : "";
      return `${event?.name ?? "Event"} · ${person}: ${value}${validity}`;
    }
    case "identity":
      return `Identity updated to ${text(after?.name, entry.actorName)}`;
    case "addParticipant":
      return `Participant added: ${text(after?.name, entityName(state, entry.entityType, entry.entityId))}`;
    case "renameParticipant":
      return `Participant renamed: ${text(before?.name, entry.entityId)} → ${text(after?.name)}`;
    case "saveEvent":
      return `Event ${text(after?.name, entityName(state, entry.entityType, entry.entityId))} saved`;
    case "saveCategory":
      return `Category ${text(after?.name, entityName(state, entry.entityType, entry.entityId))} saved`;
    case "saveTeam":
      return `Team ${text(after?.name, entityName(state, entry.entityType, entry.entityId))} saved${event ? ` for ${event.name}` : ""}`;
    case "addBracketTeam":
      return `${event?.name ?? "Event"} team added before play; matchups regenerated`;
    case "startBracket":
    case "matchWinner":
      return entry.action === "matchWinner"
        ? bracketChange(state, before, after, entry.entityId)
        : `${event?.name ?? "Event"} bracket started`;
    default:
      return `${text(entry.entityType, "Record")} ${entry.entityId} changed`;
  }
}

export function Audit({ items }: { items: AuditEntry[] }) {
  const { snapshot } = useConference();
  return (
    <div className="audit-list">
      {items.length ? items.map((entry) => (
        <article className="audit-entry" key={entry.id}>
          <FileText aria-hidden="true" />
          <div className="audit-entry-body">
            <strong>{describeAuditEntry(entry, snapshot.data)}</strong>
            <small>{new Date(entry.at).toLocaleString()} · {text(entry.actorName, entry.actorUid)}</small>
            {entry.reason && <p>{entry.reason}</p>}
            <details>
              <summary>Raw audit details</summary>
              <pre>{json(entry)}</pre>
            </details>
          </div>
        </article>
      )) : <div className="empty"><FileText aria-hidden="true" /><p>No audit entries yet.</p></div>}
    </div>
  );
}
