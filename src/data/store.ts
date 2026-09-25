import { FirebaseError, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  getIdTokenResult,
  linkWithPopup,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { addBracketEntrant, advanceBracket, appendRegistrationEntrant, createBracket, createRegistrationBracket, normalizeName } from "@/domain/ranking";
import { appendGameEntrant, createRegistrationGame, selectGameWinner, startGame } from "@/domain/knockout";
import { initialCategories, initialEvents } from "@/domain/catalog";
import type {
  AppSnapshot,
  AuditEntry,
  Bracket,
  Command,
  Competition,
  ConferenceState,
  ConferenceStore,
  Identity,
  KnockoutGame,
  Participant,
} from "@/domain/types";
import { log } from "@/lib/logging/logger";
import { DEMO_RECORDED_AT } from "./demoClock";

const IDENTITY_KEY = "uncommon-men.identity";
const DEMO_IDENTITY_KEY = "uncommon-men.demo-identity";
const DEMO_KEY = "uncommon-men.demo-state.v1";
const LEGACY_DEMO_RECORDED_AT = 1_726_000_000_000;
const LEGACY_DEMO_WINDOW_MS = 2 * 60 * 1000;
const CATALOG_SETUP_ERROR =
  "Conference events are not initialized. Ask an administrator to run the catalog provisioning step.";
const collections = [
  "categories",
  "events",
  "participants",
  "teams",
  "attempts",
  "brackets",
  "games",
  "audit",
] as const;
type CollectionName = (typeof collections)[number];

const emptyState = (): ConferenceState => ({
  categories: [],
  events: [],
  participants: [],
  teams: [],
  attempts: [],
  brackets: [],
  games: [],
  audit: [],
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = () => Date.now();
const randomId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function validateTeamInput(
  data: ConferenceState,
  command: Extract<Command, { type: "saveTeam" }>,
) {
  const event = data.events.find((item) => item.id === command.eventId);
  const name = command.name.trim();
  const memberIds = [...new Set(command.memberIds)];
  if (
    !event?.active ||
    !event.team ||
    !name ||
    name.length > 80 ||
    memberIds.length > 20 ||
    (event.teamSize > 0 && memberIds.length !== event.teamSize) ||
    memberIds.some(
      (id) => !data.participants.some((participant) => participant.id === id),
    )
  )
    throw new Error("Enter a valid team name and members.");
  return { event, name, memberIds };
}

export function validateStartBracketInput(
  data: ConferenceState,
  command: Extract<Command, { type: "startBracket" }>,
  admin: boolean,
) {
  const event = data.events.find((item) => item.id === command.eventId);
  if (!event || !event.active || event.kind !== "bracket")
    throw new Error("Bracket event not found or inactive.");
  if (!admin) throw new Error("Administrator access is required.");
  const existingBracket = data.brackets.find((item) => item.eventId === event.id);
  if (existingBracket?.status === "registration") return event;
  if (
    command.entrantIds.length < 2 ||
    new Set(command.entrantIds).size !== command.entrantIds.length
  )
    throw new Error("Bracket entrants must be distinct.");
  if (command.entrantIds.length > 128)
    throw new Error("A bracket can have at most 128 entrants.");
  const pool = event.team
    ? data.teams.filter((item) => item.eventId === event.id)
    : data.participants;
  if (command.entrantIds.some((id) => !pool.some((item) => item.id === id)))
    throw new Error("Bracket entrants are invalid for this event.");
  if (existingBracket)
    throw new Error("This event already has a bracket.");
  return event;
}

function validateBracketEntrant(
  data: ConferenceState,
  eventId: string,
  entrantId: string,
) {
  const event = data.events.find((item) => item.id === eventId);
  if (!event || !event.active || event.kind !== "bracket")
    throw new Error("Bracket event not found or inactive.");
  const pool = event.team
    ? data.teams.filter((item) => item.eventId === eventId)
    : data.participants;
  if (!pool.some((item) => item.id === entrantId))
    throw new Error("Bracket entrant is invalid for this event.");
  return event;
}

export function migrateLegacyDemoDates(data: ConferenceState): ConferenceState {
  const shift = DEMO_RECORDED_AT - LEGACY_DEMO_RECORDED_AT;
  const eventIds = new Set(initialEvents.map((event) => event.id));
  const isLegacyFixtureTime = (value: unknown) =>
    typeof value === "number" &&
    value >= LEGACY_DEMO_RECORDED_AT &&
    value <= LEGACY_DEMO_RECORDED_AT + LEGACY_DEMO_WINDOW_MS;
  return {
    ...data,
    categories: initialCategories.map((category) => ({ ...category })),
    events: initialEvents.map((event) => ({ ...event })),
    teams: data.teams.filter((team) => eventIds.has(team.eventId)),
    brackets: data.brackets.filter((bracket) => eventIds.has(bracket.eventId)),
    games: (data.games ?? []).filter((game) => eventIds.has(game.eventId)),
    attempts: data.attempts.filter((attempt) => eventIds.has(attempt.eventId)).map((attempt) => {
      if (!attempt.id.startsWith("demo-attempt-") || !isLegacyFixtureTime(attempt.createdAt))
        return attempt;
      return {
        ...attempt,
        createdAt: attempt.createdAt + shift,
        updatedAt: isLegacyFixtureTime(attempt.updatedAt)
          ? attempt.updatedAt + shift
          : attempt.updatedAt,
      };
    }),
    audit: data.audit.map((entry) => {
      if (!entry.id.startsWith("demo-audit-") || !isLegacyFixtureTime(entry.at))
        return entry;
      return { ...entry, at: entry.at + shift };
    }),
  };
}

function readRememberedIdentity(): Pick<
  Identity,
  "name" | "participantId"
> | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readDemoIdentity(): Pick<Identity, "name" | "participantId"> | null {
  try {
    const raw = localStorage.getItem(DEMO_IDENTITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function rememberIdentity(identity: Identity | null) {
  if (!identity) return;
  localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({
      name: identity.name,
      participantId: identity.participantId,
    }),
  );
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value)
    return (value as { toMillis(): number }).toMillis();
  return typeof value === "number" ? value : 0;
}

function fromFirestore<T extends Record<string, unknown>>(
  id: string,
  value: T,
): T & { id: string } {
  const result = { ...value, id } as T & { id: string };
  for (const key of ["createdAt", "updatedAt", "at"]) {
    if (key in result)
      (result as Record<string, unknown>)[key] = toMillis(
        (result as Record<string, unknown>)[key],
      );
  }
  delete (result as Record<string, unknown>).auditId;
  delete (result as Record<string, unknown>).requestId;
  delete (result as Record<string, unknown>).lastMatchIndex;
  delete (result as Record<string, unknown>).lastParentIndex;
  return result;
}

abstract class BaseStore implements ConferenceStore {
  protected listeners = new Set<() => void>();
  protected snapshot: AppSnapshot;
  constructor(snapshot: AppSnapshot) {
    this.snapshot = snapshot;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  protected emit() {
    this.listeners.forEach((listener) => listener());
  }
  protected fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("Conference store operation failed", { error: message });
    const publicMessage =
      error instanceof FirebaseError ? friendlyFirebaseError(error) : message;
    this.snapshot = { ...this.snapshot, loading: false, error: publicMessage };
    this.emit();
  }
  clearError = () => {
    this.snapshot = { ...this.snapshot, error: null };
    this.emit();
  };
  abstract execute(command: Command): Promise<void>;
  abstract signInWithGoogle(preferredName?: string): Promise<void>;
  abstract signInAdmin(): Promise<void>;
  abstract signOutAdmin(): Promise<void>;
  abstract dispose(): void;
}

class DemoStore extends BaseStore {
  constructor(createSeedState: () => ConferenceState) {
    let data = createSeedState();
    try {
      const saved = localStorage.getItem(DEMO_KEY);
      if (saved) {
        data = migrateLegacyDemoDates(JSON.parse(saved));
        localStorage.setItem(DEMO_KEY, JSON.stringify(data));
      }
    } catch {
      /* storage may be disabled */
    }
    const remembered = readDemoIdentity();
    super({
      data,
      identity: {
        uid: "demo-operator",
        name: remembered?.name || "",
        participantId: remembered?.participantId,
        admin: true,
      },
      loading: false,
      error: null,
      mode: "demo",
      connected: true,
    });
  }
  private commit(data: ConferenceState) {
    this.snapshot = { ...this.snapshot, data };
    localStorage.setItem(DEMO_KEY, JSON.stringify(data));
    this.emit();
  }
  async execute(command: Command) {
    if (this.snapshot.error) {
      this.snapshot = { ...this.snapshot, error: null };
      this.emit();
    }
    try {
      const data = clone(this.snapshot.data);
      const actor = this.snapshot.identity!;
      if (command.type === "identity") {
        const requestedName = command.name.trim();
        if (!requestedName) throw new Error("Enter your name.");
        if (requestedName.length > 80)
          throw new Error("Your name must be 80 characters or fewer.");
        const requestedParticipantId = command.participantId ?? actor.participantId;
        let participant = requestedParticipantId
          ? data.participants.find((item) => item.id === requestedParticipantId)
          : undefined;
        if (requestedParticipantId && !participant)
          throw new Error("Participant not found.");
        if (!participant) {
          const normalizedName = normalizeName(requestedName);
          participant = data.participants.find(
            (item) => item.normalizedName === normalizedName,
          );
          if (!participant) {
            participant = { id: randomId(), name: requestedName, normalizedName };
            data.participants.push(participant);
          }
        } else if (participant.id === actor.participantId) {
          const beforeParticipant = clone(participant);
          if (participant.name !== requestedName || participant.normalizedName !== normalizeName(requestedName)) {
            participant.name = requestedName;
            participant.normalizedName = normalizeName(requestedName);
            data.audit.unshift({
              id: randomId(),
              action: "renameParticipant",
              entityType: "participants",
              entityId: participant.id,
              actorUid: actor.uid,
              actorName: requestedName,
              at: now(),
              before: beforeParticipant,
              after: participant,
              reason: "Identity name updated",
            });
          }
        }
        const identity = {
          ...actor,
          name: participant.name,
          participantId: participant.id,
        };
        localStorage.setItem(
          DEMO_IDENTITY_KEY,
          JSON.stringify({
            name: identity.name,
            participantId: identity.participantId,
          }),
        );
        data.audit.unshift({
          id: randomId(),
          action: "identity",
          entityType: "identities",
          entityId: actor.uid,
          actorUid: actor.uid,
          actorName: identity.name,
          at: now(),
          before: actor,
          after: identity,
          reason: "Identity updated",
        });
        this.snapshot = { ...this.snapshot, identity };
        this.commit(data);
        return;
      }
      if (!actor.name)
        throw new Error("Set your name before recording results.");
      let before: unknown = null;
      let after: unknown = null;
      let entityType: string = command.type;
      let entityId = "";
      let reason = "Demo operation";
      if (command.type === "attempt") {
        if (
          !command.eventId ||
          !command.requestId ||
          !Number.isFinite(command.value) ||
          command.value < 0
        )
          throw new Error("Enter a valid non-negative result.");
        const event = data.events.find(
          (item) => item.id === command.eventId && item.active,
        );
        if (!event) throw new Error("Event not found or inactive.");
        if (event.kind === "bracket" || event.kind === "knockout")
          throw new Error("This event records winners instead of numeric results.");
        if (event.kind === "count" && !Number.isInteger(command.value))
          throw new Error("Count results must be whole numbers.");
        let participant = command.participantId
          ? data.participants.find((item) => item.id === command.participantId)
          : undefined;
        participant ??= data.participants.find(
          (item) => item.normalizedName === normalizeName(command.name),
        );
        if (!participant) {
          participant = {
            id: randomId(),
            name: command.name.trim(),
            normalizedName: normalizeName(command.name),
          };
          data.participants.push(participant);
        }
        if (data.attempts.some((item) => item.id === command.requestId)) return;
        if (
          !actor.participantId &&
          normalizeName(command.name) === normalizeName(actor.name)
        ) {
          const linked = { ...actor, participantId: participant.id };
          data.audit.unshift({
            id: randomId(),
            action: "identity",
            entityType: "identities",
            entityId: actor.uid,
            actorUid: actor.uid,
            actorName: actor.name,
            at: now(),
            before: actor,
            after: linked,
            reason: "Linked first result",
          });
          this.snapshot = { ...this.snapshot, identity: linked };
          localStorage.setItem(
            DEMO_IDENTITY_KEY,
            JSON.stringify({
              name: linked.name,
              participantId: linked.participantId,
            }),
          );
        }
        after = {
          id: command.requestId,
          eventId: command.eventId,
          participantId: participant.id,
          value: command.value,
          valid: true,
          recordedBy: actor.uid,
          recorderName: actor.name,
          createdAt: now(),
          updatedAt: now(),
          revision: 1,
        };
        data.attempts.push(after as ConferenceState["attempts"][number]);
        entityId = command.requestId;
      } else if (command.type === "correctAttempt") {
        const index = data.attempts.findIndex((item) => item.id === command.id);
        if (index < 0 || data.attempts[index].revision !== command.revision)
          throw new Error("This result changed. Refresh and try again.");
        before = clone(data.attempts[index]);
        after = {
          ...data.attempts[index],
          value: command.value,
          valid: command.valid,
          updatedAt: now(),
          revision: command.revision + 1,
        };
        data.attempts[index] = after as ConferenceState["attempts"][number];
        entityId = command.id;
        reason = command.reason;
      } else if (command.type === "addParticipant") {
        if (!command.name.trim())
          throw new Error("Participant name is required.");
        const normalizedName = normalizeName(command.name);
        if (
          data.participants.some(
            (item) => item.normalizedName === normalizedName,
          )
        )
          return;
        after = { id: randomId(), name: command.name.trim(), normalizedName };
        data.participants.push(after as Participant);
        entityId = (after as Participant).id;
      } else if (command.type === "renameParticipant") {
        const index = data.participants.findIndex(
          (item) => item.id === command.id,
        );
        if (index < 0) throw new Error("Participant not found.");
        before = clone(data.participants[index]);
        after = {
          ...data.participants[index],
          name: command.name.trim(),
          normalizedName: normalizeName(command.name),
        };
        data.participants[index] = after as Participant;
        entityId = command.id;
        reason = command.reason;
      } else if (command.type === "saveEvent") {
        const index = data.events.findIndex(
          (item) => item.id === command.event.id,
        );
        const value: Competition = clone(command.event);
        const previous = index < 0 ? null : data.events[index];
        before = previous ? clone(previous) : null;
        const existingGame = data.games.find((game) => game.eventId === value.id);
        if (existingGame && existingGame.status !== "registration" && previous && previous.kind !== value.kind)
          throw new Error("Scoring type cannot change after a game starts.");
        if (index < 0) data.events.push(value);
        else data.events[index] = value;
        after = value;
        entityId = value.id;
        reason = command.reason;
        entityType = "events";
      } else if (command.type === "saveCategory") {
        const index = data.categories.findIndex(
          (item) => item.id === command.category.id,
        );
        const value = clone(command.category);
        before = index < 0 ? null : clone(data.categories[index]);
        if (index < 0) data.categories.push(value);
        else data.categories[index] = value;
        after = value;
        entityId = value.id;
        reason = command.reason;
        entityType = "categories";
      } else if (command.type === "saveTeam") {
        const { name, memberIds } = validateTeamInput(data, command);
        const bracketEvent = data.events.find(
          (item) => item.id === command.eventId && item.kind === "bracket",
        );
        const existingBracket = bracketEvent
          ? data.brackets.find((item) => item.eventId === command.eventId)
          : undefined;
        if (bracketEvent && existingBracket && existingBracket.status !== "registration" && !actor.admin && !command.teamId)
          throw new Error("Administrator access is required to add teams after the bracket starts.");
        const normalizedName = normalizeName(name);
        const existing = command.teamId
          ? data.teams.findIndex((item) => item.id === command.teamId)
          : data.teams.findIndex(
              (item) =>
                item.eventId === command.eventId &&
                normalizeName(item.name) === normalizedName,
            );
        if (command.teamId && existing < 0)
          throw new Error("Team not found for this event.");
        if (existing >= 0 && data.teams[existing].eventId !== command.eventId)
          throw new Error("Team not found for this event.");
        if (existing >= 0 && !actor.admin)
          throw new Error("Administrator access is required.");
        const duplicate = data.teams.find(
          (item, index) =>
            index !== existing &&
            item.eventId === command.eventId &&
            normalizeName(item.name) === normalizedName,
        );
        if (duplicate) throw new Error("A team with this name already exists.");
        after = {
          id: existing < 0 ? randomId() : data.teams[existing].id,
          eventId: command.eventId,
          name,
          memberIds,
        };
        if (existing < 0)
          data.teams.push(after as ConferenceState["teams"][number]);
        else {
          before = clone(data.teams[existing]);
          data.teams[existing] = after as ConferenceState["teams"][number];
        }
        entityId = (after as { id: string }).id;
        entityType = "teams";
        if (bracketEvent && existing < 0 && (!existingBracket || existingBracket.status === "registration")) {
          const registration = existingBracket ?? createRegistrationBracket(command.eventId);
          const registered = appendRegistrationEntrant(registration, (after as { id: string }).id);
          if (!existingBracket) data.brackets.push(registered);
          else data.brackets[data.brackets.indexOf(existingBracket)] = registered;
          data.audit.unshift({
            id: randomId(), action: "joinBracket", entityType: "brackets",
            entityId: registered.id, actorUid: actor.uid, actorName: actor.name,
            at: now(), before: existingBracket ?? null, after: registered,
            reason: "Team created and registered for bracket",
          });
        }
      } else if (command.type === "joinBracket") {
        validateBracketEntrant(data, command.eventId, command.entrantId);
        let bracket = data.brackets.find((item) => item.eventId === command.eventId);
        const hadBracket = Boolean(bracket);
        if (!bracket) {
          bracket = createRegistrationBracket(command.eventId);
          data.brackets.push(bracket);
        }
        if (bracket.status !== "registration")
          throw new Error("Bracket registration is closed.");
        const beforeBracket = hadBracket ? clone(bracket) : null;
        const registered = appendRegistrationEntrant(bracket, command.entrantId);
        if (registered === bracket) return;
        data.brackets[data.brackets.indexOf(bracket)] = registered;
        before = beforeBracket;
        after = registered;
        entityId = registered.id;
        entityType = "brackets";
      } else if (command.type === "startBracket") {
        validateStartBracketInput(data, command, actor.admin);
        const registration = data.brackets.find((item) => item.eventId === command.eventId);
        const entrantIds = registration?.status === "registration"
          ? registration.entrants
          : command.entrantIds;
        if (registration?.status === "registration" && entrantIds.length < 2)
          throw new Error("A bracket requires two or more registered entrants.");
        after = createBracket(command.eventId, entrantIds);
        if (registration) {
          before = clone(registration);
          (after as Bracket).revision = registration.revision + 1;
          data.brackets[data.brackets.indexOf(registration)] = after as Bracket;
        } else data.brackets.push(after as Bracket);
        entityId = (after as Bracket).id;
        entityType = "brackets";
      } else if (command.type === "joinGame") {
        const event = data.events.find((item) => item.id === command.eventId);
        if (!event?.active || event.kind !== "knockout" || event.team) throw new Error("Knockout event not found or inactive.");
        if (!data.participants.some((participant) => participant.id === command.participantId)) throw new Error("Participant is invalid for this event.");
        let game = data.games.find((item) => item.eventId === command.eventId);
        const hadGame = Boolean(game);
        if (!game) { game = createRegistrationGame(command.eventId); data.games.push(game); }
        if (game.status !== "registration") throw new Error("Game registration is closed.");
        const beforeGame = hadGame ? clone(game) : null;
        const registered = appendGameEntrant(game, command.participantId);
        if (registered === game) return;
        data.games[data.games.indexOf(game)] = registered;
        before = beforeGame; after = registered; entityId = registered.id; entityType = "games";
      } else if (command.type === "startGame") {
        if (!actor.admin) throw new Error("Administrator access is required.");
        const event = data.events.find((item) => item.id === command.eventId);
        if (!event?.active || event.kind !== "knockout" || event.team) throw new Error("Knockout event not found or inactive.");
        const index = data.games.findIndex((item) => item.eventId === command.eventId);
        if (index < 0) throw new Error("A game requires two or more registered entrants.");
        before = clone(data.games[index]);
        const startedGame = startGame(data.games[index]);
        after = startedGame; data.games[index] = startedGame;
        entityId = data.games[index].id; entityType = "games";
      } else if (command.type === "gameWinner") {
        const event = data.events.find((item) => item.id === command.eventId);
        if (!event?.active || event.kind !== "knockout" || event.team)
          throw new Error("Knockout event not found or inactive.");
        const index = data.games.findIndex((item) => item.eventId === command.eventId);
        if (index < 0) throw new Error("Game not found.");
        before = clone(data.games[index]);
        const completedGame = selectGameWinner(data.games[index], command.winnerId, command.revision, actor.admin, command.reason);
        after = completedGame;
        data.games[index] = completedGame; entityId = data.games[index].id; entityType = "games"; reason = command.reason || "Winner selected";
      } else if (command.type === "addBracketTeam" || command.type === "addBracketParticipant") {
        if (!actor.admin) throw new Error("Administrator access is required.");
        const index = data.brackets.findIndex((item) => item.id === command.bracketId);
        const bracket = data.brackets[index];
        if (!bracket || bracket.revision !== command.revision)
          throw new Error("This bracket changed. Refresh and try again.");
        const event = data.events.find((item) => item.id === bracket.eventId);
        const entrantId = command.type === "addBracketTeam" ? command.teamId : command.participantId;
        const team = command.type === "addBracketTeam" && data.teams.find((item) => item.id === entrantId);
        const participant = command.type === "addBracketParticipant" && data.participants.find((item) => item.id === entrantId);
        if (event?.kind !== "bracket" || (command.type === "addBracketTeam"
          ? (!event.team || !team || team.eventId !== event.id)
          : (event.team || !participant)))
          throw new Error("Choose a registered team for this event.");
        before = clone(bracket);
        after = addBracketEntrant(bracket, entrantId);
        data.brackets[index] = after as Bracket;
        entityId = bracket.id;
        entityType = "brackets";
        reason = command.type === "addBracketTeam"
          ? "Team added before any match results; matchups regenerated"
          : "Participant added before any match results; matchups regenerated";
      } else if (command.type === "matchWinner") {
        const index = data.brackets.findIndex(
          (item) => item.id === command.bracketId,
        );
        if (index < 0 || data.brackets[index].revision !== command.revision)
          throw new Error("This bracket changed. Refresh and try again.");
        before = clone(data.brackets[index]);
        after = advanceBracket(
          data.brackets[index],
          command.matchId,
          command.winnerId,
        );
        data.brackets[index] = after as Bracket;
        entityId = command.bracketId;
        reason = command.reason || "Winner selected";
        entityType = "brackets";
      }
      data.audit.unshift({
        id: randomId(),
        action: command.type,
        entityType,
        entityId,
        actorUid: actor.uid,
        actorName: actor.name,
        at: now(),
        before,
        after,
        reason,
      });
      this.commit(data);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  async signInWithGoogle(preferredName?: string) {
    const identity = this.snapshot.identity!;
    const name = identity.name || preferredName?.trim() || "Demo Google User";
    if (!identity.name) await this.execute({ type: "identity", name });
    this.snapshot = {
      ...this.snapshot,
      identity: { ...this.snapshot.identity!, email: "demo@example.com" },
    };
    this.emit();
  }
  async signInAdmin() {
    this.snapshot = {
      ...this.snapshot,
      identity: { ...this.snapshot.identity!, admin: true },
    };
    this.emit();
  }
  async signOutAdmin() {
    this.snapshot = {
      ...this.snapshot,
      identity: { ...this.snapshot.identity!, admin: false },
    };
    this.emit();
  }
  dispose() {
    this.listeners.clear();
  }
}

class FirebaseStore extends BaseStore {
  private auth?: Auth;
  private db?: Firestore;
  private unsubscribers: Unsubscribe[] = [];
  private loaded = new Set<CollectionName>();
  private auditUnsubscribe?: Unsubscribe;
  private identityUnsubscribe?: Unsubscribe;
  private authRevision = 0;
  private authRetryTimer?: ReturnType<typeof setTimeout>;
  private authRetryDelay = 0;
  private authErrorMessage: string | null = null;
  private googleAccountInUse = false;
  private catalogReady = new Map<"categories" | "events", boolean>();
  private online = () => {
    this.snapshot = { ...this.snapshot, connected: true };
    this.emit();
  };
  private offline = () => {
    this.snapshot = { ...this.snapshot, connected: false };
    this.emit();
  };
  constructor() {
    super({
      data: emptyState(),
      identity: null,
      loading: true,
      error: null,
      mode: "firebase",
      connected: false,
    });
    void this.initialize();
  }
  private async initialize() {
    const config = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    if (Object.values(config).some((value) => !value)) {
      this.fail(
        new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* environment variables, or open ?demo=1 for the local preview.",
        ),
      );
      return;
    }
    try {
      const app = initializeApp(config);
      this.auth = getAuth(app);
      this.db = initializeFirestore(
        app,
        {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        import.meta.env.VITE_FIREBASE_DATABASE_ID || "conference",
      );
      if (import.meta.env.VITE_FIREBASE_EMULATORS === "true") {
        connectAuthEmulator(
          this.auth,
          `http://127.0.0.1:${import.meta.env.VITE_AUTH_EMULATOR_PORT || "9199"}`,
          { disableWarnings: true },
        );
        connectFirestoreEmulator(
          this.db,
          "127.0.0.1",
          Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8180),
        );
      }
      await setPersistence(this.auth, browserLocalPersistence);
      window.addEventListener("online", this.online);
      window.addEventListener("offline", this.offline);
      this.unsubscribers.push(
        onAuthStateChanged(this.auth, (user) => void this.handleUser(user)),
      );
      for (const name of collections.filter((value) => value !== "audit"))
        this.unsubscribers.push(
          onSnapshot(
            collection(this.db, name),
            { includeMetadataChanges: true },
            (result) => {
              const nextConnected =
                this.snapshot.connected || !result.metadata.fromCache;
              if (
                this.loaded.has(name) &&
                result.docChanges().length === 0 &&
                nextConnected === this.snapshot.connected
              )
                return;
              let values = result.docs.map((item) =>
                fromFirestore(item.id, item.data()),
              );
              if (name === "categories")
                values.sort(
                  (left, right) =>
                    Number(left.order ?? 0) - Number(right.order ?? 0),
                );
              if (name === "attempts")
                values.sort(
                  (left, right) =>
                    Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
                );
              const data = {
                ...this.snapshot.data,
                [name]: values,
              } as ConferenceState;
              if (name === "categories" || name === "events")
                this.catalogReady.set(name, values.length > 0);
              this.loaded.add(name);
              const catalogMissing =
                this.catalogReady.size === 2 &&
                [...this.catalogReady.values()].some((ready) => !ready);
              const catalogRestored =
                this.catalogReady.size === 2 &&
                [...this.catalogReady.values()].every(Boolean);
              this.snapshot = {
                ...this.snapshot,
                data,
                loading: this.loaded.size < collections.length,
                error: catalogMissing
                  ? CATALOG_SETUP_ERROR
                  : catalogRestored &&
                      this.snapshot.error === CATALOG_SETUP_ERROR
                    ? null
                    : this.snapshot.error,
                connected: nextConnected,
              };
              this.emit();
            },
            (error) => this.fail(error),
          ),
        );
    } catch (error) {
      this.fail(error);
    }
  }
  // Sign-in failures (for example the per-IP anonymous sign-up limit on shared
  // conference Wi-Fi) must never leave the app stuck loading. Public data stays
  // readable, the error is shown, and sign-in is retried with backoff.
  private scheduleAuthRetry(revision: number, user: User | null) {
    this.authErrorMessage = this.snapshot.error;
    this.loaded.add("audit");
    if (this.snapshot.loading && this.loaded.size >= collections.length) {
      this.snapshot = { ...this.snapshot, loading: false };
      this.emit();
    }
    clearTimeout(this.authRetryTimer);
    this.authRetryDelay = Math.min(
      this.authRetryDelay ? this.authRetryDelay * 2 : 3000,
      60000,
    );
    this.authRetryTimer = setTimeout(() => {
      if (revision !== this.authRevision) return;
      void this.handleUser(user ?? this.auth?.currentUser ?? null);
    }, this.authRetryDelay);
  }
  private clearAuthError() {
    this.authRetryDelay = 0;
    clearTimeout(this.authRetryTimer);
    if (this.authErrorMessage && this.snapshot.error === this.authErrorMessage) {
      this.snapshot = { ...this.snapshot, error: null };
      this.emit();
    }
    this.authErrorMessage = null;
  }
  private async handleUser(user: User | null) {
    const revision = ++this.authRevision;
    clearTimeout(this.authRetryTimer);
    this.auditUnsubscribe?.();
    this.auditUnsubscribe = undefined;
    this.identityUnsubscribe?.();
    this.identityUnsubscribe = undefined;
    this.snapshot = {
      ...this.snapshot,
      identity: null,
      data: { ...this.snapshot.data, audit: [] },
    };
    this.emit();
    if (!user) {
      try {
        await signInAnonymously(this.auth!);
      } catch (error) {
        this.fail(error);
        this.scheduleAuthRetry(revision, null);
      }
      return;
    }
    try {
      const token = await getIdTokenResult(user);
      if (revision !== this.authRevision) return;
      const remembered = readRememberedIdentity();
      const identityRef = doc(this.db!, "identities", user.uid);
      const identityDocument = await getDoc(identityRef);
      if (revision !== this.authRevision) return;
      let identity: Identity = {
        uid: user.uid,
        name: identityDocument.exists()
          ? String(identityDocument.data().name)
          : remembered?.name || user.displayName || "",
        participantId: identityDocument.exists()
          ? identityDocument.data().participantId || undefined
          : undefined,
        admin: token.claims.admin === true,
        email: user.isAnonymous ? undefined : user.email || undefined,
      };
      this.snapshot = { ...this.snapshot, identity };
      if (identityDocument.exists()) this.emit();
      // A new account with a remembered name, or a name saved before names
      // joined the roster, gets its roster record now.
      if (identity.name && !identity.participantId) {
        try {
          const saved = await this.saveIdentityWithParticipant(
            user.uid,
            identity.name,
            undefined,
          );
          if (revision !== this.authRevision) return;
          identity = { ...identity, name: saved.name, participantId: saved.id };
          rememberIdentity(identity);
          this.snapshot = { ...this.snapshot, identity };
          this.emit();
        } catch (error) {
          if (!identityDocument.exists()) throw error;
          log.warn("Could not add a named identity to the roster", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      this.identityUnsubscribe = onSnapshot(
        identityRef,
        (result) => {
          if (!result.exists() || this.snapshot.identity?.uid !== user.uid)
            return;
          const data = result.data();
          const next = {
            ...this.snapshot.identity,
            name: String(data.name),
            participantId: data.participantId || undefined,
          } as Identity;
          rememberIdentity(next);
          this.snapshot = { ...this.snapshot, identity: next };
          this.emit();
        },
        (error) => this.fail(error),
      );
      this.loaded.add("audit");
      if (token.claims.admin === true)
        this.auditUnsubscribe = onSnapshot(
          collection(this.db!, "audit"),
          (result) => {
            if (
              this.snapshot.identity?.uid !== user.uid ||
              !this.snapshot.identity.admin
            )
              return;
            const audit = result.docs
              .map(
                (item) =>
                  fromFirestore(item.id, item.data()) as unknown as AuditEntry,
              )
              .sort((left, right) => right.at - left.at);
            this.snapshot = {
              ...this.snapshot,
              data: {
                ...this.snapshot.data,
                audit,
              },
            };
            this.emit();
          },
          (error) => this.fail(error),
        );
      this.snapshot = {
        ...this.snapshot,
        loading: this.loaded.size < collections.length,
      };
      this.emit();
      this.clearAuthError();
    } catch (error) {
      this.fail(error);
      if (revision === this.authRevision) this.scheduleAuthRetry(revision, user);
    }
  }
  private requireReady() {
    if (!this.db || !this.auth?.currentUser)
      throw new Error("Firebase is still connecting.");
    return { db: this.db, actor: this.snapshot.identity! };
  }
  private requireAdmin() {
    const ready = this.requireReady();
    if (!ready.actor.admin)
      throw new Error("Administrator access is required.");
    return ready;
  }
  private async auditedWrite(
    path: string,
    action: string,
    reason: string,
    transform: (
      before: Record<string, unknown> | null,
    ) => Record<string, unknown>,
    expectedRevision?: number,
    actorName?: string,
  ) {
    const { db, actor } = this.requireReady();
    const target = doc(db, path);
    const auditId = randomId();
    const auditRef = doc(db, "audit", auditId);
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(target);
      const before = existing.exists() ? existing.data() : null;
      if (
        expectedRevision !== undefined &&
        before?.revision !== expectedRevision
      )
        throw new Error("This record changed. Refresh and try again.");
      const after = { ...transform(before), auditId };
      transaction.set(target, after);
      transaction.set(auditRef, {
        action,
        entityType: path.split("/")[0],
        entityId: path.split("/")[1],
        actorUid: actor.uid,
        actorName: actorName ?? actor.name,
        at: serverTimestamp(),
        before,
        after,
        reason,
      });
    });
  }
  // Entering a name puts that person on the conference roster, so teammates
  // can pick them for a team right away. An existing record with the same
  // name is linked rather than duplicated.
  private async saveIdentityWithParticipant(
    uid: string,
    name: string,
    participantId: string | undefined,
    explicitParticipantId = false,
  ): Promise<{ id: string; name: string }> {
    const db = this.requireReady().db;
    const normalizedName = normalizeName(name);
    if (!name.trim()) throw new Error("Enter your name.");
    if (name.length > 80) throw new Error("Your name must be 80 characters or fewer.");
    const identityRef = doc(db, "identities", uid);
    const identityAuditRef = doc(db, "audit", randomId());
    let savedName = name;
    let savedId = participantId;
    await retryOnRace(() =>
      runTransaction(db, async (transaction) => {
        const identitySnapshot = await transaction.get(identityRef);
        const persistedParticipantId = identitySnapshot.exists()
          ? identitySnapshot.data().participantId || undefined
          : undefined;
        const targetId =
          participantId ??
          persistedParticipantId ??
          this.snapshot.data.participants.find(
            (item) => item.normalizedName === normalizedName,
          )?.id ??
          (await participantDocumentId(normalizedName));
        const participantRef = doc(db, "participants", targetId);
        const participantSnapshot = await transaction.get(participantRef);
        const at = serverTimestamp();
        const canRename = persistedParticipantId === targetId;
        if (!participantSnapshot.exists()) {
          if (explicitParticipantId || persistedParticipantId === targetId)
            throw new Error("Participant not found.");
          const participantAfter = {
            name,
            normalizedName,
            auditId: randomId(),
          };
          const participantAuditRef = doc(db, "audit", participantAfter.auditId);
          transaction.set(participantRef, participantAfter);
          transaction.set(participantAuditRef, {
            action: "addParticipant",
            entityType: "participants",
            entityId: targetId,
            actorUid: uid,
            actorName: name,
            at,
            before: null,
            after: participantAfter,
            reason: "Joined the roster by entering a name",
          });
          savedName = name;
        } else if (canRename) {
          const before = participantSnapshot.data();
          if (before.name !== name || before.normalizedName !== normalizedName) {
            const participantAfter = {
              name,
              normalizedName,
              auditId: randomId(),
            };
            const participantAuditRef = doc(db, "audit", participantAfter.auditId);
            transaction.set(participantRef, participantAfter);
            transaction.set(participantAuditRef, {
              action: "renameParticipant",
              entityType: "participants",
              entityId: targetId,
              actorUid: uid,
              actorName: name,
              at,
              before,
              after: participantAfter,
              reason: "Identity name updated",
            });
          }
          savedName = name;
        } else {
          savedName = String(participantSnapshot.data().name);
        }
        const identityAfter = {
          uid,
          name: savedName,
          participantId: targetId,
          auditId: identityAuditRef.id,
        };
        transaction.set(identityRef, identityAfter);
        transaction.set(identityAuditRef, {
          action: "identity",
          entityType: "identities",
          entityId: uid,
          actorUid: uid,
          actorName: savedName,
          at,
          before: identitySnapshot.exists() ? identitySnapshot.data() : null,
          after: identityAfter,
          reason: "Identity updated",
        });
        savedId = targetId;
      }),
    );
    return { id: savedId!, name: savedName };
  }
  async execute(command: Command) {
    if (this.snapshot.error && this.snapshot.error !== CATALOG_SETUP_ERROR) {
      this.snapshot = { ...this.snapshot, error: null };
      this.emit();
    }
    try {
      if (command.type === "identity") {
        const actor = this.requireReady().actor;
        const identity = {
          ...actor,
          name: command.name.trim(),
          participantId: command.participantId,
        };
        if (!identity.name) throw new Error("Enter your name.");
        const saved = await this.saveIdentityWithParticipant(
          actor.uid,
          identity.name,
          command.participantId ?? actor.participantId,
          command.participantId !== undefined,
        );
        identity.name = saved.name;
        identity.participantId = saved.id;
        rememberIdentity(identity);
        this.snapshot = { ...this.snapshot, identity };
        this.emit();
        return;
      }
      if (!this.snapshot.identity?.name)
        throw new Error("Set your name before recording results.");
      if (command.type === "attempt") {
        if (
          !command.eventId ||
          !command.requestId ||
          !Number.isFinite(command.value) ||
          command.value < 0
        )
          throw new Error("Enter a valid non-negative result.");
        const event = this.snapshot.data.events.find(
          (item) => item.id === command.eventId && item.active,
        );
        if (!event) throw new Error("Event not found or inactive.");
        if (event.kind === "bracket" || event.kind === "knockout")
          throw new Error("This event records winners instead of numeric results.");
        if (event.kind === "count" && !Number.isInteger(command.value))
          throw new Error("Count results must be whole numbers.");
        const { db, actor } = this.requireReady();
        const requestRef = doc(db, "attempts", command.requestId);
        const auditRef = doc(db, "audit", randomId());
        let linkedParticipantId: string | undefined;
        await retryOnRace(() => runTransaction(db, async (transaction) => {
          if ((await transaction.get(requestRef)).exists()) return;
          const identityRef = doc(db, "identities", actor.uid);
          const identitySnapshot = actor.participantId
            ? null
            : await transaction.get(identityRef);
          const normalizedName = normalizeName(command.name);
          const deterministicId = await participantDocumentId(normalizedName);
          let participant: Participant | undefined = command.participantId
            ? this.snapshot.data.participants.find(
                (item) => item.id === command.participantId,
              )
            : undefined;
          participant ??= this.snapshot.data.participants.find(
            (item) => item.normalizedName === normalizedName,
          );
          if (!participant) {
            const participantRef = doc(db, "participants", deterministicId);
            const existingParticipant = await transaction.get(participantRef);
            if (existingParticipant.exists())
              participant = fromFirestore(
                deterministicId,
                existingParticipant.data(),
              ) as unknown as Participant;
            else {
              participant = {
                id: deterministicId,
                name: command.name.trim(),
                normalizedName,
              };
              const participantAuditRef = doc(db, "audit", randomId());
              const participantAfter = {
                name: participant.name,
                normalizedName: participant.normalizedName,
                auditId: participantAuditRef.id,
              };
              transaction.set(participantRef, participantAfter);
              transaction.set(participantAuditRef, {
                action: "addParticipant",
                entityType: "participants",
                entityId: deterministicId,
                actorUid: actor.uid,
                actorName: actor.name,
                at: serverTimestamp(),
                before: null,
                after: participantAfter,
                reason: "Created with first result",
              });
            }
          }
          const at = serverTimestamp();
          const after = {
            eventId: command.eventId,
            participantId: participant.id,
            value: command.value,
            valid: true,
            recordedBy: actor.uid,
            recorderName: actor.name,
            createdAt: at,
            updatedAt: at,
            revision: 1,
            requestId: command.requestId,
            auditId: auditRef.id,
          };
          transaction.set(requestRef, after);
          transaction.set(auditRef, {
            action: "attempt",
            entityType: "attempts",
            entityId: command.requestId,
            actorUid: actor.uid,
            actorName: actor.name,
            at,
            before: null,
            after,
            reason: "Result submitted",
          });
          if (
            !actor.participantId &&
            normalizedName === normalizeName(actor.name)
          ) {
            const identityAuditRef = doc(db, "audit", randomId());
            const identityAfter = {
              uid: actor.uid,
              name: actor.name,
              participantId: participant.id,
              auditId: identityAuditRef.id,
            };
            transaction.set(identityRef, identityAfter);
            transaction.set(identityAuditRef, {
              action: "identity",
              entityType: "identities",
              entityId: actor.uid,
              actorUid: actor.uid,
              actorName: actor.name,
              at,
              before: identitySnapshot?.exists()
                ? identitySnapshot.data()
                : null,
              after: identityAfter,
              reason: "Linked first result",
            });
            linkedParticipantId = participant.id;
          }
        }));
        if (linkedParticipantId) {
          const identity = { ...actor, participantId: linkedParticipantId };
          rememberIdentity(identity);
          this.snapshot = { ...this.snapshot, identity };
          this.emit();
        }
        return;
      }
      if (command.type === "correctAttempt") {
        this.requireAdmin();
        await this.auditedWrite(
          `attempts/${command.id}`,
          "correctAttempt",
          command.reason,
          (before) => ({
            ...before,
            value: command.value,
            valid: command.valid,
            updatedAt: serverTimestamp(),
            revision: command.revision + 1,
          }),
          command.revision,
        );
        return;
      }
      if (command.type === "addParticipant") {
        const normalized = normalizeName(command.name);
        if (!normalized) throw new Error("Participant name is required.");
        if (
          this.snapshot.data.participants.some(
            (item) => item.normalizedName === normalized,
          )
        )
          return;
        const id = await participantDocumentId(normalized);
        const { db, actor } = this.requireReady();
        const participantRef = doc(db, "participants", id);
        const auditRef = doc(db, "audit", randomId());
        // A phone returning from sleep can show a cached roster that is missing
        // someone another device just added. Rewriting that record would be an
        // update, which only administrators may make, so an existing record is
        // left alone and the live roster catches up on its own.
        await retryOnRace(() =>
          runTransaction(db, async (transaction) => {
            if ((await transaction.get(participantRef)).exists()) return;
            const after = {
              name: command.name.trim(),
              normalizedName: normalized,
              auditId: auditRef.id,
            };
            transaction.set(participantRef, after);
            transaction.set(auditRef, {
              action: "addParticipant",
              entityType: "participants",
              entityId: id,
              actorUid: actor.uid,
              actorName: actor.name,
              at: serverTimestamp(),
              before: null,
              after,
              reason: "Participant added",
            });
          }),
        );
        return;
      }
      if (command.type === "renameParticipant") {
        this.requireAdmin();
        await this.auditedWrite(
          `participants/${command.id}`,
          "renameParticipant",
          command.reason,
          (before) => ({
            ...before,
            name: command.name.trim(),
            normalizedName: normalizeName(command.name),
          }),
        );
        return;
      }
      if (command.type === "saveEvent") {
        this.requireAdmin();
        const { id, ...event } = command.event;
        await this.auditedWrite(
          `events/${id}`,
          "saveEvent",
          command.reason,
          (before) => {
            if (
              before &&
              this.snapshot.data.attempts.some((item) => item.eventId === id) &&
              (before.kind !== event.kind ||
                before.direction !== event.direction ||
                before.team !== event.team)
            )
              throw new Error(
                "Scoring type, direction, and team mode cannot change after results exist.",
              );
            if (
              before &&
              this.snapshot.data.games.some((game) => game.eventId === id && game.status !== "registration") &&
              before.kind !== event.kind
            )
              throw new Error("Scoring type cannot change after a game starts.");
            return event;
          },
        );
        return;
      }
      if (command.type === "saveCategory") {
        this.requireAdmin();
        const { id, ...category } = command.category;
        await this.auditedWrite(
          `categories/${id}`,
          "saveCategory",
          command.reason,
          () => category,
        );
        return;
      }
      if (command.type === "saveTeam") {
        const { name, memberIds } = validateTeamInput(this.snapshot.data, command);
        const normalizedName = normalizeName(name);
        const existing = command.teamId
          ? this.snapshot.data.teams.find((item) => item.id === command.teamId)
          : this.snapshot.data.teams.find(
              (item) =>
                item.eventId === command.eventId &&
                normalizeName(item.name) === normalizedName,
            );
        if (existing && existing.eventId !== command.eventId)
          throw new Error("Team not found for this event.");
        const duplicate = this.snapshot.data.teams.find(
          (item) =>
            item.id !== existing?.id &&
            item.eventId === command.eventId &&
            normalizeName(item.name) === normalizedName,
        );
        if (duplicate) throw new Error("A team with this name already exists.");
        const id = existing?.id || command.teamId || randomId();
        const { db, actor } = this.requireReady();
        const teamRef = doc(db, "teams", id);
        const eventRef = doc(db, "events", command.eventId);
        const bracketRef = doc(db, "brackets", `${command.eventId}-bracket`);
        const participantRefs = memberIds.map((memberId) =>
          doc(db, "participants", memberId),
        );
        const auditRef = doc(db, "audit", randomId());
        const bracketAuditRef = doc(db, "audit", randomId());
        await runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const teamSnapshot = await transaction.get(teamRef);
          const bracketSnapshot = await transaction.get(bracketRef);
          const participantSnapshots = [];
          for (const participantRef of participantRefs)
            participantSnapshots.push(await transaction.get(participantRef));
          const eventData = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!eventData?.active || !eventData.team || eventData.teamSize === undefined)
            throw new Error("Enter a valid team name and members.");
          if (Number(eventData.teamSize) > 0 && memberIds.length !== Number(eventData.teamSize))
            throw new Error("Enter a valid team name and members.");
          if (participantSnapshots.some((snapshot) => !snapshot.exists()))
            throw new Error("Enter a valid team name and members.");
          if ((command.teamId || existing) && !teamSnapshot.exists())
            throw new Error("Team not found for this event.");
          if (teamSnapshot.exists()) {
            const teamData = teamSnapshot.data();
            if (teamData.eventId !== command.eventId)
              throw new Error("Team not found for this event.");
            if (!actor.admin) throw new Error("Administrator access is required.");
          }
          const bracketData = bracketSnapshot.exists() ? bracketSnapshot.data() : null;
          if (eventData?.kind === "bracket" && bracketData && bracketData.status !== "registration" && !actor.admin && !teamSnapshot.exists())
            throw new Error("Administrator access is required to add teams after the bracket starts.");
          const before = teamSnapshot.exists() ? teamSnapshot.data() : null;
          const after = {
            eventId: command.eventId,
            name,
            memberIds,
            auditId: auditRef.id,
          };
          transaction.set(teamRef, after);
          transaction.set(auditRef, {
            action: "saveTeam",
            entityType: "teams",
            entityId: id,
            actorUid: actor.uid,
            actorName: actor.name,
            at: serverTimestamp(),
            before,
            after,
            reason: "Team saved",
          });
          if (eventData.kind === "bracket" && !teamSnapshot.exists() && (!bracketData || bracketData.status === "registration")) {
            const registration = bracketData
              ? (fromFirestore(bracketRef.id, bracketData) as unknown as Bracket)
              : createRegistrationBracket(command.eventId);
            const registered = appendRegistrationEntrant(registration, id);
            const { id: _, ...storedBracket } = registered;
            transaction.set(bracketRef, { ...storedBracket, auditId: bracketAuditRef.id });
            transaction.set(bracketAuditRef, {
              action: "joinBracket", entityType: "brackets", entityId: bracketRef.id,
              actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(),
              before: bracketData, after: { ...storedBracket, auditId: bracketAuditRef.id },
              reason: "Team created and registered for bracket",
            });
          }
        });
        return;
      }
      if (command.type === "joinBracket") {
        const { db, actor } = this.requireReady();
        const eventRef = doc(db, "events", command.eventId);
        const entrantRef = doc(db, "participants", command.entrantId);
        const teamRef = doc(db, "teams", command.entrantId);
        const bracketRef = doc(db, "brackets", `${command.eventId}-bracket`);
        const auditRef = doc(db, "audit", randomId());
        await retryOnRace(() => runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const bracketSnapshot = await transaction.get(bracketRef);
          const event = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!event?.active || event.kind !== "bracket")
            throw new Error("Bracket event not found or inactive.");
          const entrantSnapshot = await transaction.get(event.team ? teamRef : entrantRef);
          if (!entrantSnapshot.exists() || (event.team === true && entrantSnapshot.data().eventId !== command.eventId))
            throw new Error("Bracket entrant is invalid for this event.");
          const bracket = bracketSnapshot.exists()
            ? (fromFirestore(bracketRef.id, bracketSnapshot.data()) as unknown as Bracket)
            : createRegistrationBracket(command.eventId);
          if (bracket.status !== "registration") throw new Error("Bracket registration is closed.");
          const registered = appendRegistrationEntrant(bracket, command.entrantId);
          if (registered === bracket) return;
          const { id: _, ...stored } = registered;
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(bracketRef, after);
          transaction.set(auditRef, {
            action: "joinBracket", entityType: "brackets", entityId: bracketRef.id,
            actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(),
            before: bracketSnapshot.exists() ? bracketSnapshot.data() : null,
            after, reason: "Entrant joined bracket registration",
          });
        }));
        return;
      }
      if (command.type === "startBracket") {
        const { db, actor } = this.requireAdmin();
        const eventRef = doc(db, "events", command.eventId);
        const bracketRef = doc(db, "brackets", `${command.eventId}-bracket`);
        const auditRef = doc(db, "audit", randomId());
        await runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const bracketSnapshot = await transaction.get(bracketRef);
          const event = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!event?.active || event.kind !== "bracket") throw new Error("Bracket event not found or inactive.");
          const registration = bracketSnapshot.exists()
            ? (fromFirestore(bracketRef.id, bracketSnapshot.data()) as unknown as Bracket)
            : undefined;
          const entrantIds = registration?.status === "registration" ? registration.entrants : command.entrantIds;
          if (registration?.status === "registration" && entrantIds.length < 2)
            throw new Error("A bracket requires two or more registered entrants.");
          if (entrantIds.length > 128)
            throw new Error("A bracket can have at most 128 entrants.");
          if (registration && registration.status !== "registration") throw new Error("This event already has a bracket.");
          const pool = event.team ? "teams" : "participants";
          for (const entrantId of entrantIds) {
            const entrant = await transaction.get(doc(db, pool, entrantId));
            if (!entrant.exists() || (event.team && entrant.data().eventId !== command.eventId))
              throw new Error("Bracket entrants are invalid for this event.");
          }
          const bracket = createBracket(command.eventId, entrantIds);
          if (registration) bracket.revision = registration.revision + 1;
          const { id: _, ...stored } = bracket;
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(bracketRef, after);
          transaction.set(auditRef, {
            action: "startBracket", entityType: "brackets", entityId: bracketRef.id,
            actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(),
            before: bracketSnapshot.exists() ? bracketSnapshot.data() : null,
            after, reason: "Bracket started",
          });
        });
        return;
      }
      if (command.type === "joinGame") {
        const { db, actor } = this.requireReady();
        const eventRef = doc(db, "events", command.eventId);
        const participantRef = doc(db, "participants", command.participantId);
        const gameRef = doc(db, "games", `${command.eventId}-game`);
        const auditRef = doc(db, "audit", randomId());
        await retryOnRace(() => runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const participantSnapshot = await transaction.get(participantRef);
          const gameSnapshot = await transaction.get(gameRef);
          const event = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!event?.active || event.kind !== "knockout" || event.team) throw new Error("Knockout event not found or inactive.");
          if (!participantSnapshot.exists()) throw new Error("Participant is invalid for this event.");
          const game = gameSnapshot.exists() ? fromFirestore(gameRef.id, gameSnapshot.data()) as unknown as KnockoutGame : createRegistrationGame(command.eventId);
          if (game.status !== "registration") throw new Error("Game registration is closed.");
          const registered = appendGameEntrant(game, command.participantId);
          if (registered === game) return;
          const { id: _, ...stored } = registered;
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(gameRef, after);
          transaction.set(auditRef, { action: "joinGame", entityType: "games", entityId: gameRef.id, actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(), before: gameSnapshot.exists() ? gameSnapshot.data() : null, after, reason: "Entrant joined knockout registration" });
        }));
        return;
      }
      if (command.type === "startGame") {
        const { db, actor } = this.requireAdmin();
        const eventRef = doc(db, "events", command.eventId);
        const gameRef = doc(db, "games", `${command.eventId}-game`);
        const auditRef = doc(db, "audit", randomId());
        await runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const gameSnapshot = await transaction.get(gameRef);
          const event = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!event?.active || event.kind !== "knockout" || event.team) throw new Error("Knockout event not found or inactive.");
          if (!gameSnapshot.exists()) throw new Error("A game requires two or more registered entrants.");
          const game = fromFirestore(gameRef.id, gameSnapshot.data()) as unknown as KnockoutGame;
          const started = startGame(game);
          const { id: _, ...stored } = started;
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(gameRef, after);
          transaction.set(auditRef, { action: "startGame", entityType: "games", entityId: gameRef.id, actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(), before: gameSnapshot.data(), after, reason: "Knockout game started" });
        });
        return;
      }
      if (command.type === "gameWinner") {
        const { db, actor } = this.requireReady();
        const eventRef = doc(db, "events", command.eventId);
        const gameRef = doc(db, "games", `${command.eventId}-game`);
        const auditRef = doc(db, "audit", randomId());
        await retryOnRace(() => runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const gameSnapshot = await transaction.get(gameRef);
          const event = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!event?.active || event.kind !== "knockout" || event.team)
            throw new Error("Knockout event not found or inactive.");
          if (!gameSnapshot.exists()) throw new Error("Game not found.");
          const game = fromFirestore(gameRef.id, gameSnapshot.data()) as unknown as KnockoutGame;
          const updated = selectGameWinner(game, command.winnerId, command.revision, actor.admin, command.reason);
          const { id: _, ...stored } = updated;
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(gameRef, after);
          transaction.set(auditRef, { action: "gameWinner", entityType: "games", entityId: gameRef.id, actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(), before: gameSnapshot.data(), after, reason: command.reason || "Winner selected" });
        }));
        return;
      }
      if (command.type === "addBracketTeam" || command.type === "addBracketParticipant") {
        const { db, actor } = this.requireAdmin();
        const target = doc(db, "brackets", command.bracketId);
        const auditRef = doc(db, "audit", randomId());
        await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(target);
          const before = existing.exists() ? existing.data() : null;
          if (!before || before.revision !== command.revision)
            throw new Error("This bracket changed. Refresh and try again.");
          const bracket = fromFirestore(command.bracketId, before) as unknown as Bracket;
          const event = await transaction.get(doc(db, "events", bracket.eventId));
          const entrantId = command.type === "addBracketTeam" ? command.teamId : command.participantId;
          const entrant = await transaction.get(doc(
            db,
            command.type === "addBracketTeam" ? "teams" : "participants",
            entrantId,
          ));
          if (!event.exists() || event.data().kind !== "bracket"
            || (command.type === "addBracketTeam"
              ? (!event.data().team || !entrant.exists() || entrant.data().eventId !== bracket.eventId)
              : (event.data().team || !entrant.exists())))
            throw new Error("Choose a registered entrant for this event.");
          const { id: _, ...stored } = addBracketEntrant(bracket, entrantId);
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(target, after);
          transaction.set(auditRef, {
            action: command.type, entityType: "brackets", entityId: target.id,
            actorUid: actor.uid, actorName: actor.name, at: serverTimestamp(),
            before, after, reason: "Team added before any match results; matchups regenerated",
          });
        });
        return;
      }
      if (command.type === "matchWinner") {
        await retryOnRace(() => this.auditedWrite(
          `brackets/${command.bracketId}`,
          "matchWinner",
          command.reason || "Winner selected",
          (before) => {
            const bracket = fromFirestore(
              command.bracketId,
              before!,
            ) as unknown as Bracket;
            const lastMatchIndex = bracket.matches.findIndex(
              (match) => match.id === command.matchId,
            );
            if (lastMatchIndex < 0) throw new Error("Match not found.");
            const existingWinner = bracket.matches[lastMatchIndex].winnerId;
            // Scorekeepers on different matches of the same bracket must not
            // conflict, so only corrections of a decided match need the exact
            // revision the admin was looking at.
            if (existingWinner === command.winnerId) throw new AlreadyRecorded();
            if (existingWinner && !this.snapshot.identity?.admin)
              throw new Error(
                "Another scorekeeper already recorded this match. Ask an administrator to correct it.",
              );
            if (existingWinner && bracket.revision !== command.revision)
              throw new Error("This bracket changed. Refresh and try again.");
            const parent = bracket.matches.find(
              (match) =>
                match.round === bracket.matches[lastMatchIndex].round + 1 &&
                match.position ===
                  Math.floor(bracket.matches[lastMatchIndex].position / 2),
            );
            const lastParentIndex = parent
              ? bracket.matches.findIndex((match) => match.id === parent.id)
              : -1;
            const after = advanceBracket(
              bracket,
              command.matchId,
              command.winnerId,
            );
            const { id: _, ...stored } = after;
            return { ...stored, lastMatchIndex, lastParentIndex };
          },
        )).catch((error) => {
          if (!(error instanceof AlreadyRecorded)) throw error;
        });
      }
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  // Google sign-in upgrades the device's current account in place, so its
  // name, participant link and results carry over. If that Google account is
  // already in use (another device, or an administrator), switch to it.
  async signInWithGoogle(preferredName?: string) {
    if (!this.auth) throw new Error("Firebase is not configured.");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const current = this.auth.currentUser;
    try {
      if (!current?.isAnonymous || this.googleAccountInUse) {
        this.googleAccountInUse = false;
        await signInWithPopup(this.auth, provider);
        return;
      }
      let linked: User;
      try {
        linked = (await linkWithPopup(current, provider)).user;
      } catch (error) {
        const inUse =
          error instanceof FirebaseError &&
          (error.code === "auth/credential-already-in-use" ||
            error.code === "auth/email-already-in-use");
        if (!inUse) throw error;
        const credential = GoogleAuthProvider.credentialFromError(error);
        if (credential) {
          await signInWithCredential(this.auth, credential);
          return;
        }
        // A second popup here would be blocked on phones (no fresh tap), so
        // the next tap signs straight into the existing Google account.
        this.googleAccountInUse = true;
        throw new GoogleAccountInUse();
      }
      const identity = this.snapshot.identity;
      if (!identity || identity.uid !== linked.uid) return;
      this.snapshot = {
        ...this.snapshot,
        identity: { ...identity, email: linked.email || undefined },
      };
      this.emit();
      const name = identity.name || preferredName?.trim() || linked.displayName?.trim();
      if (!identity.name && name) {
        const normalized = normalizeName(name);
        await this.execute({
          type: "identity",
          name,
          participantId: this.snapshot.data.participants.find(
            (participant) => participant.normalizedName === normalized,
          )?.id,
        });
      }
    } catch (error) {
      if (error instanceof GoogleAccountInUse) throw error;
      if (
        error instanceof FirebaseError &&
        ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"].includes(error.code)
      )
        throw error;
      this.fail(error);
      throw error;
    }
  }
  async signInAdmin() {
    await this.signInWithGoogle();
  }
  async signOutAdmin() {
    if (!this.auth) return;
    this.auditUnsubscribe?.();
    this.auditUnsubscribe = undefined;
    this.snapshot = {
      ...this.snapshot,
      identity: null,
      data: { ...this.snapshot.data, audit: [] },
    };
    this.emit();
    await signOut(this.auth);
  }
  dispose() {
    clearTimeout(this.authRetryTimer);
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.auditUnsubscribe?.();
    this.identityUnsubscribe?.();
    window.removeEventListener("online", this.online);
    window.removeEventListener("offline", this.offline);
    this.unsubscribers = [];
    this.listeners.clear();
  }
}

class AlreadyRecorded extends Error {}
export class GoogleAccountInUse extends Error {
  code = "app/google-account-in-use";
}

// When two devices commit to the same document at the same instant (two
// scorekeepers on one bracket, or two stations creating the same new
// competitor), the losing commit is validated against the winner's data and
// rejected as permission-denied instead of a retryable conflict. Re-running the
// transaction reads the fresh document and succeeds.
async function retryOnRace<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = error instanceof FirebaseError ? error.code : "";
      if (
        attempt >= 2 ||
        !["permission-denied", "aborted", "failed-precondition"].some((suffix) =>
          code.endsWith(suffix),
        )
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 150 + Math.random() * 350),
      );
    }
  }
}

async function participantDocumentId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `name-${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function friendlyFirebaseError(error: FirebaseError): string {
  if (
    [
      "auth/too-many-requests",
      "auth/network-request-failed",
      "auth/internal-error",
      "auth/quota-exceeded",
      "auth/admin-restricted-operation",
    ].includes(error.code)
  )
    return "Connecting your device is taking longer than usual. Standings stay live; recording will be ready shortly. Retrying automatically…";
  if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request")
    return "Google sign-in was closed before it finished.";
  if (error.code === "auth/popup-blocked")
    return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
  if (error.code.endsWith("resource-exhausted"))
    return "The live conference service is at capacity. Try again in a moment.";
  if (error.code.endsWith("permission-denied"))
    return "This action is not allowed for the current account. Refresh and try again, or ask an administrator for access.";
  if (error.code.endsWith("unavailable"))
    return "The live conference service is temporarily unavailable. Check your connection and try again.";
  if (error.code.endsWith("unauthenticated"))
    return "Your sign-in session is not ready. Refresh and try again.";
  if (error.code.endsWith("failed-precondition"))
    return "The conference data is not ready for this action. Refresh, then ask an administrator if the problem continues.";
  return "The live conference service could not complete this action. Try again.";
}

export async function createConferenceStore(): Promise<ConferenceStore> {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1"
  ) {
    // Sample data is only needed for ?demo=1, so live visitors never download it.
    const { createSeedState } = await import("./seed");
    return new DemoStore(createSeedState);
  }
  return new FirebaseStore();
}
