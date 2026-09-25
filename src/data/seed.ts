import { DEMO_RECORDED_AT } from "./demoClock";
import { initialCategories, initialEvents } from "@/domain/catalog";
import { advanceBracket, createBracket, normalizeName } from "@/domain/ranking";
import type {
  Attempt,
  AuditEntry,
  Bracket,
  ConferenceState,
  KnockoutGame,
  Participant,
  Team,
} from "@/domain/types";

export { DEMO_RECORDED_AT };

const names = [
  "Caleb Johnson",
  "Marcus Reed",
  "Daniel Brooks",
  "Aaron Davis",
  "Ethan Cole",
  "Isaiah Cole",
  "Noah Bennett",
  "Micah Stone",
];
const participants: Participant[] = names.map((name, index) => ({
  id: `demo-p${index + 1}`,
  name,
  normalizedName: normalizeName(name),
}));
const participantId = (name: string) =>
  participants.find((participant) => participant.name === name)!.id;

const baseTeams: Team[] = [
  {
    id: "demo-team-iron-brothers",
    eventId: "cornhole",
    name: "Iron Brothers",
    memberIds: [participantId("Caleb Johnson"), participantId("Marcus Reed")],
  },
  {
    id: "demo-team-oak-street",
    eventId: "cornhole",
    name: "Oak Street",
    memberIds: [participantId("Daniel Brooks"), participantId("Aaron Davis")],
  },
  {
    id: "demo-team-the-anchors",
    eventId: "cornhole",
    name: "The Anchors",
    memberIds: [participantId("Ethan Cole"), participantId("Isaiah Cole")],
  },
  {
    id: "demo-team-northside",
    eventId: "cornhole",
    name: "Northside",
    memberIds: [participantId("Noah Bennett"), participantId("Micah Stone")],
  },
];
const teamEvents = initialEvents
  .filter((event) => event.team && event.kind === "bracket")
  .map((event) => event.id);
const teams: Team[] = teamEvents.flatMap((eventId) =>
  baseTeams.map((team) => ({ ...team, id: `${team.id}-${eventId}`, eventId })),
);
const makeAttempt = (
  eventId: string,
  person: string,
  value: number,
  index: number,
  valid = true,
): Attempt => ({
  id: `demo-attempt-${eventId}-${participantId(person)}-${index}`,
  eventId,
  participantId: participantId(person),
  value,
  valid,
  recordedBy: "demo-operator",
  recorderName: "Demo operator",
  createdAt: DEMO_RECORDED_AT + index,
  updatedAt: DEMO_RECORDED_AT + index,
  revision: 1,
});
const numericPeople = [
  "Caleb Johnson",
  "Marcus Reed",
  "Daniel Brooks",
  "Aaron Davis",
  "Ethan Cole",
  "Isaiah Cole",
  "Noah Bennett",
  "Micah Stone",
];
const attemptsFor = (eventId: string, values: number[], offset: number) =>
  numericPeople.map((name, index) =>
    makeAttempt(eventId, name, values[index], offset + index),
  );
const numericAttempts: Attempt[] = [
  ...attemptsFor("dumbbell-hold-15-lb", [62.4, 58.1, 54.7, 51.2, 48.6, 45.3, 42.8, 39.9], 1),
  ...attemptsFor("dumbbell-hold-20-lb", [44.8, 41.2, 38.5, 35.9, 33.6, 30.7, 28.4, 25.1], 10),
  ...attemptsFor("push-up", [52, 49, 46, 43, 40, 37, 34, 31], 10),
  ...attemptsFor(
    "plank-holds",
    [181.2, 172.4, 165.8, 154.5, 146.1, 139.8, 128.2, 120.7],
    20,
  ),
  ...attemptsFor("basketball-free-throws", [18, 17, 15, 14, 13, 12, 10, 9], 30),
  ...attemptsFor(
    "pound-the-nail",
    [24.8, 26.1, 28.7, 30.2, 33.5, 35.1, 37.9, 40.4],
    40,
  ),
  ...attemptsFor(
    "grid-based-logic-puzzle",
    [92, 101, 108, 116, 124, 131, 139, 147],
    50,
  ),
  ...attemptsFor("sudoku", [184, 196, 207, 219, 231, 244, 256, 270], 60),
];

function finishBracket(bracket: Bracket): Bracket {
  let current = bracket;
  for (
    let round = 1;
    round <= Math.max(...current.matches.map((match) => match.round));
    round += 1
  ) {
    for (const match of current.matches.filter(
      (item) =>
        item.round === round && item.sideA && item.sideB && !item.winnerId,
    ))
      current = advanceBracket(current, match.id, match.sideA!);
  }
  return current;
}

function createDemoBrackets(): Bracket[] {
  const brackets = initialEvents
    .filter((event) => event.kind === "bracket" && !event.team)
    .map((event) =>
      finishBracket(
        createBracket(
          event.id,
          participants.map((participant) => participant.id),
        ),
      ),
    );
  const cornholeTeams = teams.filter((team) => team.eventId === "cornhole");
  let cornhole = createBracket(
    "cornhole",
    cornholeTeams.map((team) => team.id),
  );
  cornhole = advanceBracket(
    cornhole,
    cornhole.matches.find((match) => match.round === 1 && match.position === 0)!
      .id,
    cornholeTeams[0].id,
  );
  cornhole = advanceBracket(
    cornhole,
    cornhole.matches.find((match) => match.round === 1 && match.position === 1)!
      .id,
    cornholeTeams[2].id,
  );
  brackets.push(cornhole);
  teamEvents
    .filter((eventId) => eventId !== "cornhole")
    .forEach((eventId) =>
      brackets.push(
        finishBracket(
          createBracket(
            eventId,
            teams
              .filter((team) => team.eventId === eventId)
              .map((team) => team.id),
          ),
        ),
      ),
    );
  return brackets;
}

function createDemoGames(): KnockoutGame[] {
  const event = initialEvents.find((item) => item.id === "lightning-knockout");
  if (!event || (event.kind !== "knockout" && event.kind !== "bracket")) return [];
  return [{
    id: "lightning-knockout-game",
    eventId: "lightning-knockout",
    entrants: participants.slice(0, 2).map((participant) => participant.id),
    status: "registration",
    winnerId: null,
    revision: 1,
  }];
}

const audit: AuditEntry[] = [];

export function createSeedState(): ConferenceState {
  return {
    categories: initialCategories.map((category) => ({ ...category })),
    events: initialEvents.map((event) => ({ ...event })),
    participants: participants.map((participant) => ({ ...participant })),
    teams: teams.map((team) => ({ ...team, memberIds: [...team.memberIds] })),
    attempts: numericAttempts.map((attempt) => ({ ...attempt })),
    brackets: createDemoBrackets(),
    games: createDemoGames(),
    audit: audit.map((entry) => ({ ...entry })),
  };
}
