import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { normalizeName } from "@/domain/ranking";
import type { Participant } from "@/domain/types";

// A search box for choosing people. Suggestions drop down beneath the box as
// you type, chosen people show as removable chips, and creating a new
// participant is only offered when nobody on the roster has that name.
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
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [creating, setCreating] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
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
        .filter((participant) => !selected.includes(participant.id) && nameOf(participant).includes(normalizedQuery))
        .sort(
          (left, right) =>
            Number(nameOf(right).startsWith(normalizedQuery)) - Number(nameOf(left).startsWith(normalizedQuery)) ||
            left.name.localeCompare(right.name),
        )
        .slice(0, 50),
    [participants, normalizedQuery, selected],
  );
  const showCreate = Boolean(normalizedQuery) && !exact;
  const optionCount = visible.length + (showCreate ? 1 : 0);
  const listOpen = open && !full && (optionCount > 0 || Boolean(normalizedQuery));
  const listId = `${id}-list`;
  const optionId = (index: number) => `${listId}-${index}`;
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
  const reset = () => {
    setQuery("");
    setActiveIndex(-1);
    setOpen(false);
  };
  const choose = (participantId: string) => {
    if (!selected.includes(participantId) && !full) onChange([...selected, participantId]);
    reset();
  };
  const remove = (participantId: string) => {
    onChange(selected.filter((item) => item !== participantId));
    window.requestAnimationFrame(() => input.current?.focus());
  };
  const create = async () => {
    const name = query.trim();
    if (!name || exact || creating) return;
    setCreating(true);
    try {
      if (await onCreate(name)) {
        setPendingName(normalizeName(name));
        reset();
      }
    } finally {
      setCreating(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!listOpen) { setOpen(true); return; }
      if (!optionCount) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      // Enter picks a suggestion instead of submitting the surrounding form.
      event.preventDefault();
      const index = activeIndex >= 0 ? activeIndex : exact && !selected.includes(exact.id) ? visible.indexOf(exact) : normalizedQuery ? 0 : -1;
      if (index >= 0 && index < visible.length) choose(visible[index].id);
      else if (index === visible.length && showCreate) void create();
      else if (exact) reset();
    } else if (event.key === "Escape" && listOpen) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Backspace" && !query && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };
  const nameFor = (participantId: string) => participants.find((item) => item.id === participantId)?.name ?? "Unknown";
  return (
    <div className="participant-picker">
      <div className="bracket-field">
        <label htmlFor={id}>{label}</label>
        {selected.length > 0 && (
          <ul className="picker-chips" aria-label={`Selected ${label.toLowerCase()}`}>
            {selected.map((participantId) => (
              <li key={participantId}>
                {nameFor(participantId)}
                <button type="button" aria-label={`Remove ${nameFor(participantId)}`} onClick={() => remove(participantId)}><X aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className={`competitor ${listOpen ? "open" : ""}`}>
          <input
            id={id}
            ref={input}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            disabled={full}
            placeholder={full ? "Remove someone to swap" : "Search for a name"}
            value={query}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(event.target.value.trim() ? 0 : -1);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          {listOpen && (
            <ul className="competitor-suggestions" id={listId} role="listbox" aria-label={label}>
              {visible.map((participant, index) => (
                <li
                  key={participant.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(participant.id)}
                >
                  <Search aria-hidden="true" />
                  <span>{participant.name}</span>
                </li>
              ))}
              {showCreate && (
                <li
                  id={optionId(visible.length)}
                  role="option"
                  aria-selected={activeIndex === visible.length}
                  aria-disabled={creating}
                  className={`new-competitor ${activeIndex === visible.length ? "active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(visible.length)}
                  onClick={() => void create()}
                >
                  <UserPlus aria-hidden="true" />
                  <span>{creating ? "Adding…" : <>Add new participant: <strong>{query.trim()}</strong></>}</span>
                </li>
              )}
              {!optionCount && <li className="picker-empty" role="presentation">No other matches.</li>}
            </ul>
          )}
        </div>
      </div>
      {max > 0 && <p className="picker-status" aria-live="polite">{selected.length} of {max} selected</p>}
    </div>
  );
}
