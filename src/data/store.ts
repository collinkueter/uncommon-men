import { FirebaseError, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  getIdTokenResult,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
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
import { addBracketEntrant, advanceBracket, createBracket, normalizeName } from "@/domain/ranking";
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
  Participant,
} from "@/domain/types";
import { log } from "@/lib/logging/logger";
import { createSeedState, DEMO_RECORDED_AT } from "./seed";

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
    !event?.team ||
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
  abstract signInAdmin(): Promise<void>;
  abstract signOutAdmin(): Promise<void>;
  abstract dispose(): void;
}

class DemoStore extends BaseStore {
  constructor() {
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
        const identity = {
          ...actor,
          name: command.name.trim(),
          participantId: command.participantId,
        };
        if (!identity.name) throw new Error("Enter your name.");
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
        const value = clone(command.event);
        before = index < 0 ? null : clone(data.events[index]);
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
      } else if (command.type === "startBracket") {
        after = createBracket(command.eventId, command.entrantIds);
        data.brackets.push(after as Bracket);
        entityId = (after as Bracket).id;
        entityType = "brackets";
      } else if (command.type === "addBracketTeam") {
        if (!actor.admin) throw new Error("Administrator access is required.");
        const index = data.brackets.findIndex((item) => item.id === command.bracketId);
        const bracket = data.brackets[index];
        if (!bracket || bracket.revision !== command.revision)
          throw new Error("This bracket changed. Refresh and try again.");
        const event = data.events.find((item) => item.id === bracket.eventId);
        const team = data.teams.find((item) => item.id === command.teamId);
        if (!event?.team || event.kind !== "bracket" || team?.eventId !== event.id)
          throw new Error("Choose a registered team for this event.");
        before = clone(bracket);
        after = addBracketEntrant(bracket, command.teamId);
        data.brackets[index] = after as Bracket;
        entityId = bracket.id;
        entityType = "brackets";
        reason = "Team added before any match results; matchups regenerated";
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
      let identityDocument = await getDoc(identityRef);
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
      };
      this.snapshot = { ...this.snapshot, identity };
      if (identityDocument.exists()) this.emit();
      if (!identityDocument.exists() && identity.name) {
        const initialName = identity.name;
        await this.auditedWrite(
          `identities/${user.uid}`,
          "identity",
          "Identity initialized",
          () => ({
            uid: user.uid,
            name: initialName,
            participantId: null,
          }),
          undefined,
          initialName,
        );
        if (revision !== this.authRevision) return;
        identityDocument = await getDoc(identityRef);
        if (revision !== this.authRevision) return;
        identity = { ...identity, name: initialName, participantId: undefined };
        this.snapshot = { ...this.snapshot, identity };
        this.emit();
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
        await this.auditedWrite(
          `identities/${actor.uid}`,
          "identity",
          "Identity updated",
          () => ({
            uid: actor.uid,
            name: identity.name,
            participantId: identity.participantId || null,
          }),
          undefined,
          identity.name,
        );
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
        await this.auditedWrite(
          `participants/${id}`,
          "addParticipant",
          "Participant added",
          (before) => {
            if (before) return before;
            return { name: command.name.trim(), normalizedName: normalized };
          },
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
        const participantRefs = memberIds.map((memberId) =>
          doc(db, "participants", memberId),
        );
        const auditRef = doc(db, "audit", randomId());
        await runTransaction(db, async (transaction) => {
          const eventSnapshot = await transaction.get(eventRef);
          const teamSnapshot = await transaction.get(teamRef);
          const participantSnapshots = [];
          for (const participantRef of participantRefs)
            participantSnapshots.push(await transaction.get(participantRef));
          const eventData = eventSnapshot.exists() ? eventSnapshot.data() : null;
          if (!eventData?.team || eventData.teamSize === undefined)
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
        });
        return;
      }
      if (command.type === "startBracket") {
        this.requireAdmin();
        const event = this.snapshot.data.events.find(
          (item) => item.id === command.eventId && item.kind === "bracket",
        );
        const pool = event?.team
          ? this.snapshot.data.teams.filter(
              (item) => item.eventId === command.eventId,
            )
          : this.snapshot.data.participants;
        if (
          !event ||
          command.entrantIds.some((id) => !pool.some((item) => item.id === id))
        )
          throw new Error("Bracket entrants are invalid for this event.");
        const bracket = createBracket(command.eventId, command.entrantIds);
        const { id, ...stored } = bracket;
        await this.auditedWrite(
          `brackets/${id}`,
          "startBracket",
          "Bracket started",
          (before) => {
            if (before) throw new Error("This event already has a bracket.");
            return stored;
          },
        );
        return;
      }
      if (command.type === "addBracketTeam") {
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
          const team = await transaction.get(doc(db, "teams", command.teamId));
          if (!event.exists() || !event.data().team || event.data().kind !== "bracket"
            || !team.exists() || team.data().eventId !== bracket.eventId)
            throw new Error("Choose a registered team for this event.");
          const { id: _, ...stored } = addBracketEntrant(bracket, command.teamId);
          const after = { ...stored, auditId: auditRef.id };
          transaction.set(target, after);
          transaction.set(auditRef, {
            action: "addBracketTeam", entityType: "brackets", entityId: target.id,
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
  async signInAdmin() {
    if (!this.auth) throw new Error("Firebase is not configured.");
    try {
      await signInWithPopup(this.auth, new GoogleAuthProvider());
    } catch (error) {
      this.fail(error);
      throw error;
    }
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

export function createConferenceStore(): ConferenceStore {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1"
    ? new DemoStore()
    : new FirebaseStore();
}
