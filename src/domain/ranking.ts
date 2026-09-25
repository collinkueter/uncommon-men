import type {
  Attempt,
  Bracket,
  Competition,
  ConferenceState,
  Match,
  Standing,
} from "./types";

const placementPoints = [10, 8, 6, 5, 4, 3, 2, 1, 0];

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Best valid attempt per event and competitor, built in one pass and cached per
// attempts/events array so standings stay cheap as results accumulate.
const bestIndexCache = new WeakMap<
  Attempt[],
  WeakMap<Competition[], Map<string, Attempt>>
>();
function bestAttemptIndex(state: ConferenceState): Map<string, Attempt> {
  let byEvents = bestIndexCache.get(state.attempts);
  if (!byEvents) {
    byEvents = new WeakMap();
    bestIndexCache.set(state.attempts, byEvents);
  }
  let index = byEvents.get(state.events);
  if (index) return index;
  const lower = new Set(
    state.events.filter((event) => event.direction === "lower").map((event) => event.id),
  );
  index = new Map();
  for (const attempt of state.attempts) {
    if (!attempt.valid || !Number.isFinite(attempt.value)) continue;
    const key = `${attempt.eventId}\u0000${attempt.participantId}`;
    const current = index.get(key);
    if (
      !current ||
      (lower.has(attempt.eventId)
        ? attempt.value < current.value
        : attempt.value > current.value)
    )
      index.set(key, attempt);
  }
  byEvents.set(state.events, index);
  return index;
}

export function getBestAttempt(
  state: ConferenceState,
  eventId: string,
  participantId: string,
): Attempt | undefined {
  return bestAttemptIndex(state).get(`${eventId}\u0000${participantId}`);
}

function pointsForRanks(ranks: number[]): number[] {
  return ranks.map((rank) => {
    const tied = ranks.filter((item) => item === rank).length;
    let total = 0;
    for (let i = 0; i < tied; i += 1)
      total +=
        placementPoints[Math.min(rank - 1 + i, placementPoints.length - 1)];
    return total / tied;
  });
}

function standingsFromValues(
  values: Array<{
    id: string;
    name: string;
    value: number;
    eventsPlayed?: number;
  }>,
  direction: "higher" | "lower" = "higher",
  pointsOverride?: Map<string, number>,
): Standing[] {
  const sorted = [...values].sort((a, b) =>
    direction === "lower" ? a.value - b.value : b.value - a.value,
  );
  const ranks: number[] = [];
  sorted.forEach((item, index) =>
    ranks.push(
      index > 0 && item.value === sorted[index - 1].value
        ? ranks[index - 1]
        : index + 1,
    ),
  );
  const points = pointsForRanks(ranks);
  return sorted.map((item, index) => ({
    ...item,
    rank: ranks[index],
    points: pointsOverride?.get(item.id) ?? points[index],
    eventsPlayed: item.eventsPlayed ?? 1,
  }));
}

function bracketStandings(
  state: ConferenceState,
  event: Competition,
): Standing[] {
  const bracket = state.brackets.find(
    (item) => item.eventId === event.id && item.status === "complete",
  );
  if (!bracket) return [];
  const final = bracket.matches.filter(
    (m) => m.round === Math.max(...bracket.matches.map((x) => x.round)),
  )[0];
  const winner = final?.winnerId;
  if (!winner) return [];
  const rounds = Math.max(...bracket.matches.map((x) => x.round));
  const ranks = new Map<string, number>();
  bracket.entrants.forEach((id) => ranks.set(id, rounds + 1));
  bracket.matches
    .filter((m) => m.winnerId)
    .forEach((m) => {
      const loser = m.sideA === m.winnerId ? m.sideB : m.sideA;
      if (loser) ranks.set(loser, 2 ** (rounds - m.round) + 1);
    });
  ranks.set(winner, 1);
  const names = new Map(state.participants.map((p) => [p.id, p.name]));
  state.teams
    .filter((t) => t.eventId === event.id)
    .forEach((t) => names.set(t.id, t.name));
  return standingsFromValues(
    bracket.entrants.map((id) => ({
      id,
      name: names.get(id) ?? id,
      value: -(ranks.get(id) ?? 99),
    })),
  ).map((standing) => ({ ...standing, value: standing.rank }));
}

function knockoutStandings(
  state: ConferenceState,
  event: Competition,
): Standing[] {
  const game = (state.games ?? []).find((item) => item.eventId === event.id);
  if (!game || game.status !== "complete" || !game.winnerId) return [];
  if (!game.entrants.includes(game.winnerId)) return [];
  const names = new Map(state.participants.map((p) => [p.id, p.name]));
  const registered = [...new Set(game.entrants)];
  return [game.winnerId, ...registered.filter((id) => id !== game.winnerId)].map((id) => ({
    id,
    name: names.get(id) ?? id,
    rank: id === game.winnerId ? 1 : 0,
    points: id === game.winnerId ? 10 : 0,
    value: id === game.winnerId ? 1 : 0,
    eventsPlayed: 1,
  }));
}

export function eventStandings(
  state: ConferenceState,
  eventId: string,
): Standing[] {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return [];
  if (event.kind === "bracket") return bracketStandings(state, event);
  if (event.kind === "knockout") return knockoutStandings(state, event);
  const people = event.team
    ? state.teams
        .filter((t) => t.eventId === eventId)
        .map((t) => ({ id: t.id, name: t.name }))
    : state.participants.map((p) => ({ id: p.id, name: p.name }));
  const values = people.flatMap((person) => {
    const attempt = getBestAttempt(state, eventId, person.id);
    return attempt ? [{ ...person, value: attempt.value }] : [];
  });
  return standingsFromValues(values, event.direction);
}

export function categoryStandings(
  state: ConferenceState,
  categoryId: string,
): Standing[] {
  const events = state.events.filter(
    (event) => event.categoryId === categoryId && event.active && !event.team,
  );
  const totals = new Map<
    string,
    { name: string; points: number; eventsPlayed: number }
  >();
  events.forEach((event) =>
    eventStandings(state, event.id).forEach((standing) => {
      const current = totals.get(standing.id) ?? {
        name: standing.name,
        points: 0,
        eventsPlayed: 0,
      };
      current.points += standing.points;
      current.eventsPlayed += 1;
      totals.set(standing.id, current);
    }),
  );
  const values = [...totals].map(([id, data]) => ({
    id,
    name: data.name,
    value: data.points,
    eventsPlayed: data.eventsPlayed,
  }));
  return standingsFromValues(
    values,
    "higher",
    new Map(values.map((item) => [item.id, item.value])),
  );
}

export function overallStandings(state: ConferenceState): Standing[] {
  const totals = new Map<
    string,
    { name: string; points: number; eventsPlayed: number }
  >();
  state.events
    .filter((event) => event.active && !event.team)
    .forEach((event) =>
      eventStandings(state, event.id).forEach((standing) => {
        const current = totals.get(standing.id) ?? {
          name: standing.name,
          points: 0,
          eventsPlayed: 0,
        };
        current.points += standing.points;
        current.eventsPlayed += 1;
        totals.set(standing.id, current);
      }),
    );
  const values = [...totals].map(([id, data]) => ({
    id,
    name: data.name,
    value: data.points,
    eventsPlayed: data.eventsPlayed,
  }));
  return standingsFromValues(
    values,
    "higher",
    new Map(values.map((item) => [item.id, item.value])),
  );
}

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

function rebuild(bracket: Bracket): Bracket {
  const matches = bracket.matches.map((m) => ({ ...m }));
  const rounds = Math.max(...matches.map((m) => m.round));
  const subtreeHasEntrant = (match: Match): boolean => {
    if (match.round === 1) return Boolean(match.sideA || match.sideB);
    const children = matches.filter(
      (candidate) =>
        candidate.round === match.round - 1 &&
        Math.floor(candidate.position / 2) === match.position,
    );
    return children.some(subtreeHasEntrant);
  };
  for (let round = 1; round <= rounds; round += 1) {
    matches
      .filter((m) => m.round === round)
      .forEach((m) => {
        const previousA = m.sideA;
        const previousB = m.sideB;
        if (round > 1) {
          const feeders = matches
            .filter(
              (candidate) =>
                candidate.round === round - 1 &&
                Math.floor(candidate.position / 2) === m.position,
            )
            .sort((a, b) => a.position - b.position);
          m.sideA = feeders[0]?.winnerId ?? null;
          m.sideB = feeders[1]?.winnerId ?? null;
          if (m.sideA !== previousA || m.sideB !== previousB) m.winnerId = null;
        }
        const available = [m.sideA, m.sideB].filter(Boolean) as string[];
        const hasA =
          round === 1
            ? Boolean(m.sideA)
            : subtreeHasEntrant(
                matches.find(
                  (candidate) =>
                    candidate.round === round - 1 &&
                    candidate.position === m.position * 2,
                )!,
              );
        const hasB =
          round === 1
            ? Boolean(m.sideB)
            : subtreeHasEntrant(
                matches.find(
                  (candidate) =>
                    candidate.round === round - 1 &&
                    candidate.position === m.position * 2 + 1,
                )!,
              );
        if (available.length === 1 && (!hasA || !hasB)) {
          m.bye = true;
          m.winnerId = available[0];
        } else if (available.length === 1) {
          m.bye = false;
          m.winnerId = null;
        } else if (available.length === 0) {
          m.bye = false;
          m.winnerId = null;
        } else {
          m.bye = false;
          if (m.winnerId && !available.includes(m.winnerId)) m.winnerId = null;
        }
      });
  }
  const final = matches.find((m) => m.round === rounds);
  return {
    ...bracket,
    matches,
    status: final?.winnerId ? "complete" : "active",
    revision: bracket.revision + 1,
  };
}

export function createBracket(eventId: string, entrantIds: string[]): Bracket {
  if (
    !eventId ||
    entrantIds.length < 2 ||
    entrantIds.some((id) => !id) ||
    new Set(entrantIds).size !== entrantIds.length
  )
    throw new Error("A bracket requires two or more unique entrants");
  const size = nextPowerOfTwo(entrantIds.length);
  const rounds = Math.log2(size);
  const byeCount = size - entrantIds.length;
  const slots: Array<string | null> = [];
  for (let position = 0; position < size / 2; position += 1) {
    if (position < byeCount) slots.push(null, entrantIds[position]);
    else {
      const entrantIndex = byeCount + (position - byeCount) * 2;
      slots.push(
        entrantIds[entrantIndex] ?? null,
        entrantIds[entrantIndex + 1] ?? null,
      );
    }
  }
  const matches: Match[] = [];
  for (let round = 1; round <= rounds; round += 1)
    for (let position = 0; position < size / 2 ** round; position += 1) {
      matches.push({
        id: `${eventId}-r${round}-m${position}`,
        round,
        position,
        sideA: round === 1 ? slots[position * 2] : null,
        sideB: round === 1 ? slots[position * 2 + 1] : null,
        winnerId: null,
        bye: false,
      });
    }
  return rebuild({
    id: `${eventId}-bracket`,
    eventId,
    entrants: [...entrantIds],
    matches,
    status: "active",
    revision: 0,
    entrantsOpen: true,
  });
}

export function createRegistrationBracket(eventId: string): Bracket {
  if (!eventId) throw new Error("A bracket event is required");
  return {
    id: `${eventId}-bracket`,
    eventId,
    entrants: [],
    matches: [],
    status: "registration",
    // The empty draft is persisted only after its first entrant is appended;
    // appendRegistrationEntrant then gives the saved registration revision 1.
    revision: 0,
    entrantsOpen: true,
  };
}

export function appendRegistrationEntrant(
  bracket: Bracket,
  entrantId: string,
): Bracket {
  if (bracket.status !== "registration" || !bracket.entrantsOpen)
    throw new Error("Bracket registration is closed.");
  if (!entrantId) throw new Error("A bracket entrant is required.");
  if (bracket.entrants.includes(entrantId)) return bracket;
  if (bracket.entrants.length >= 128)
    throw new Error("A bracket can have at most 128 entrants.");
  return {
    ...bracket,
    entrants: [...bracket.entrants, entrantId],
    revision: bracket.revision + 1,
  };
}

export function canAddBracketEntrants(bracket: Bracket): boolean {
  return bracket.status === "active"
    && (bracket.entrantsOpen ?? bracket.revision === 1)
    && !bracket.matches.some((match) => !match.bye && match.winnerId !== null);
}

export function addBracketEntrant(bracket: Bracket, entrantId: string): Bracket {
  if (!canAddBracketEntrants(bracket))
    throw new Error("Teams cannot be added after a match result has been recorded.");
  if (!entrantId || bracket.entrants.includes(entrantId))
    throw new Error("Choose a team that is not already in this bracket.");
  if (bracket.entrants.length >= 128)
    throw new Error("A bracket can have at most 128 entrants.");
  return {
    ...createBracket(bracket.eventId, [...bracket.entrants, entrantId]),
    id: bracket.id,
    revision: bracket.revision + 1,
  };
}

export function advanceBracket(
  bracket: Bracket,
  matchId: string,
  winnerId: string,
): Bracket {
  const match = bracket.matches.find((item) => item.id === matchId);
  if (!match) throw new Error("Unknown bracket match");
  if (
    !match.sideA ||
    !match.sideB ||
    ![match.sideA, match.sideB].includes(winnerId) ||
    match.bye
  )
    throw new Error("Winner must be an active side in this match");
  const matches = bracket.matches.map((item) =>
    item.id === matchId ? { ...item, winnerId } : item,
  );
  return rebuild({ ...bracket, matches, entrantsOpen: false });
}

export function formatScore(value: number, event: Competition): string {
  if (event.kind !== "duration") return String(value);
  const hundredths = Math.max(0, Math.round(value * 100));
  const minutes = Math.floor(hundredths / 6000);
  const seconds = Math.floor((hundredths % 6000) / 100);
  const centiseconds = hundredths % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}
