import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { UserPlus } from "lucide-react";
import { normalizeName } from "@/domain/ranking";
import type { Participant } from "@/domain/types";

// One field for choosing people: the whole conference roster is listed up
// front and narrows as you type, and creating a new participant is only
// offered when nobody on the roster already has that name.
export function ParticipantPicker({
  id,
  label,
  participants,
  selected,
  onChange,
  max = 0,
  onCreate,
}: {
  id: string;
  label: string;
  participants: Participant[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const normalizedQuery = normalizeName(query);
  const full = max > 0 && selected.length >= max;
  const nameOf = (participant: Participant) =>
    participant.normalizedName || normalizeName(participant.name);
  const exact = normalizedQuery
    ? participants.find((participant) => nameOf(participant) === normalizedQuery)
    : undefined;
  const visible = useMemo(
    () =>
      participants
        .filter((participant) => nameOf(participant).includes(normalizedQuery))
        .sort(
          (left, right) =>
            Number(selected.includes(right.id)) - Number(selected.includes(left.id)) ||
            left.name.localeCompare(right.name),
        ),
    [participants, normalizedQuery, selected],
  );
  // A new participant shows up in the live roster a moment after it is
  // created; select them as soon as it does.
  useEffect(() => {
    if (!pendingName) return;
    const created = participants.find((participant) => nameOf(participant) === pendingName);
    if (!created) return;
    setPendingName(null);
    if (!selected.includes(created.id) && !(max > 0 && selected.length >= max))
      onChange([...selected, created.id]);
  }, [participants, pendingName, selected, max, onChange]);
  const toggle = (participantId: string) => {
    if (selected.includes(participantId))
      onChange(selected.filter((item) => item !== participantId));
    else if (!full) onChange([...selected, participantId]);
  };
  const create = async () => {
    const name = query.trim();
    if (!name || exact || creating) return;
    setCreating(true);
    try {
      if (await onCreate(name)) {
        setPendingName(normalizeName(name));
        setQuery("");
      }
    } finally {
      setCreating(false);
    }
  };
  // Enter picks the only match, or adds the typed name when nobody matches,
  // instead of submitting the surrounding form.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (exact) {
      if (!selected.includes(exact.id)) toggle(exact.id);
      setQuery("");
    } else if (visible.length === 1 && normalizedQuery) {
      if (!selected.includes(visible[0].id)) toggle(visible[0].id);
      setQuery("");
    } else if (normalizedQuery && !visible.length) void create();
  };
  const listId = `${id}-list`;
  return (
    <div className="participant-picker">
      <div className="bracket-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="search"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          aria-controls={listId}
          placeholder="Start typing a name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <p className="picker-status" aria-live="polite">
        {max > 0
          ? `${selected.length} of ${max} selected${full ? " · uncheck someone to swap" : ""}`
          : `${selected.length} selected`}
        {normalizedQuery ? ` · ${visible.length} ${visible.length === 1 ? "match" : "matches"}` : ` · ${participants.length} on the roster`}
      </p>
      <div className="roster-checks" id={listId}>
        {visible.map((participant) => {
          const checked = selected.includes(participant.id);
          return (
            <label className="check" key={participant.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && full}
                onChange={() => toggle(participant.id)}
              />
              {participant.name}
            </label>
          );
        })}
        {!visible.length && (
          <p className="picker-empty">
            {normalizedQuery ? `No one on the roster matches “${query.trim()}”.` : "No participants yet."}
          </p>
        )}
      </div>
      {normalizedQuery && !exact && (
        <button
          type="button"
          className="picker-create"
          disabled={creating}
          onClick={() => void create()}
        >
          <UserPlus aria-hidden="true" />
          {creating ? "Adding…" : visible.length
            ? `None of these? Add “${query.trim()}” as someone new`
            : `Add “${query.trim()}” as a new participant`}
        </button>
      )}
    </div>
  );
}
