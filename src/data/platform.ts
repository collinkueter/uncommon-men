// Platform data outside any one conference: the conference list, the default
// conference, organizers and their audit log. Firebase-backed with realtime
// listeners, or browser-local under ?demo=1.
import { FirebaseError } from "firebase/app";
import {
  GoogleAuthProvider,
  getIdTokenResult,
  linkWithPopup,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { initialCategories, initialEvents } from "@/domain/catalog";
import {
  copyCatalog,
  detailsError,
  emailError,
  LAST_ORGANIZER_ERROR,
  normalizeEmail,
  planConferenceCreation,
  removesLastOrganizer,
  resolveServerTime,
  type CatalogCopy,
  type ConferenceChanges,
  type NewConferenceInput,
  type PlatformStore,
} from "@/domain/conferences";
import type {
  AuditEntry,
  ConferenceState,
  PlatformSnapshot,
  RoleGrant,
} from "@/domain/types";
import { log } from "@/lib/logging/logger";
import { getFirebaseServices } from "./firebase";
import {
  commitConferenceCreation,
  newAuditId,
  readCatalog,
  setConferenceAdminRole,
  setDefaultConference,
  setOrganizerRole,
  updateConference,
  type PlatformActor,
} from "./platformWrites";
import {
  DEMO_ORGANIZER_EMAIL,
  readDemoPlatform,
  subscribeDemoPlatform,
  writeDemoPlatform,
  type DemoPlatformState,
} from "./demoPlatform";
import { demoStateKey, toConference } from "./store";

const initialSnapshot = (mode: PlatformSnapshot["mode"]): PlatformSnapshot => ({
  mode,
  identity: null,
  identityLoading: true,
  conferences: [],
  conferencesLoading: true,
  defaultConferenceId: null,
  organizers: [],
  audit: [],
  error: null,
});

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value)
    return (value as { toMillis(): number }).toMillis();
  return typeof value === "number" ? value : 0;
}

function publicMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request")
      return "Google sign-in was closed before it finished.";
    if (error.code === "auth/popup-blocked")
      return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
    if (error.code.endsWith("permission-denied"))
      return "This action is not allowed for your account. Organizer access (or admin access to this conference) is required.";
    if (error.code.endsWith("unavailable"))
      return "The live conference service is temporarily unavailable. Check your connection and try again.";
    return "The live conference service could not complete this action. Try again.";
  }
  return error instanceof Error ? error.message : String(error);
}

abstract class BasePlatformStore implements PlatformStore {
  protected snapshot: PlatformSnapshot;
  private listeners = new Set<() => void>();
  constructor(mode: PlatformSnapshot["mode"]) {
    this.snapshot = initialSnapshot(mode);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  protected set(changes: Partial<PlatformSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener());
  }
  clearError() {
    this.set({ error: null });
  }
  /** Runs a command and rethrows a readable message. */
  protected async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      log.error("Platform command failed", { error: error instanceof Error ? error.message : String(error) });
      throw new Error(publicMessage(error));
    }
  }
  dispose() {
    this.listeners.clear();
  }
  abstract signIn(): Promise<void>;
  abstract signOut(): Promise<void>;
  abstract createConference(input: NewConferenceInput, onProgress?: (done: number, total: number) => void): Promise<void>;
  abstract updateConference(conferenceId: string, changes: ConferenceChanges, reason?: string): Promise<void>;
  abstract setDefaultConference(conferenceId: string): Promise<void>;
  abstract setOrganizer(email: string, grant: boolean): Promise<void>;
  abstract setConferenceAdmin(conferenceId: string, email: string, grant: boolean): Promise<void>;
  abstract watchConferenceAdmins(
    conferenceId: string,
    listener: (admins: RoleGrant[] | null, error?: string) => void,
  ): () => void;
  abstract readCatalog(conferenceId: string): Promise<CatalogCopy>;
}

class FirebasePlatformStore extends BasePlatformStore {
  private auth?: Auth;
  private db?: Firestore;
  private ready: Promise<void>;
  private disposed = false;
  private revision = 0;
  private roles = { claim: false, platform: false };
  private unsubscribers: Unsubscribe[] = [];
  private roleUnsubscribe?: Unsubscribe;
  private conferencesUnsubscribe?: Unsubscribe;
  private conferencesScope?: "all" | "public";
  private organizerUnsubscribers: Unsubscribe[] = [];

  constructor() {
    super("firebase");
    this.ready = this.initialize();
  }

  private async initialize() {
    try {
      const { auth, db, ready } = getFirebaseServices();
      this.auth = auth;
      this.db = db;
      await ready;
      if (this.disposed) return;
      this.unsubscribers.push(
        onSnapshot(
          doc(db, "settings", "platform"),
          (result) => {
            const value = result.exists() ? result.data().defaultConferenceId : null;
            this.set({ defaultConferenceId: typeof value === "string" ? value : null });
          },
          (error) => log.warn("Platform settings listener failed", { error: error.message }),
        ),
        onAuthStateChanged(auth, (user) => void this.handleUser(user)),
      );
    } catch (error) {
      this.set({ error: publicMessage(error), identityLoading: false, conferencesLoading: false });
    }
  }

  private async handleUser(user: User | null) {
    if (this.disposed) return;
    const revision = ++this.revision;
    this.roleUnsubscribe?.();
    this.roleUnsubscribe = undefined;
    this.roles = { claim: false, platform: false };
    if (!user || user.isAnonymous) {
      this.set({ identity: null, identityLoading: false });
      this.applyRoles();
      return;
    }
    let claim = false;
    try {
      claim = (await getIdTokenResult(user)).claims.admin === true;
    } catch (error) {
      log.warn("Token lookup failed", { error: String(error) });
    }
    if (revision !== this.revision) return;
    this.roles.claim = claim;
    this.set({
      identity: {
        uid: user.uid,
        email: user.email ?? undefined,
        name: user.displayName || user.email || "Signed in",
        organizer: claim,
      },
    });
    const email = user.emailVerified && user.email ? user.email.toLowerCase() : null;
    if (!email) {
      this.set({ identityLoading: false });
      this.applyRoles();
      return;
    }
    // Listened to, so a grant or revoke applies without signing in again.
    this.roleUnsubscribe = onSnapshot(
      doc(this.db!, "platformRoles", email),
      (result) => {
        if (revision !== this.revision) return;
        this.roles.platform = result.exists();
        this.set({ identityLoading: false });
        this.applyRoles();
      },
      (error) => {
        if (revision !== this.revision) return;
        log.warn("Organizer role lookup failed", { error: error.message });
        this.roles.platform = false;
        this.set({ identityLoading: false });
        this.applyRoles();
      },
    );
  }

  private applyRoles() {
    const organizer = this.roles.claim || this.roles.platform;
    const identity = this.snapshot.identity;
    if (identity && identity.organizer !== organizer) this.set({ identity: { ...identity, organizer } });
    this.listenConferences(organizer ? "all" : "public");
    if (organizer) this.listenOrganizerData();
    else {
      this.organizerUnsubscribers.forEach((unsubscribe) => unsubscribe());
      this.organizerUnsubscribers = [];
      if (this.snapshot.organizers.length || this.snapshot.audit.length) this.set({ organizers: [], audit: [] });
    }
  }

  // Rules are not filters: everyone but organizers must ask only for live and
  // archived conferences. Drafts are listed for organizers.
  private listenConferences(scope: "all" | "public") {
    if (this.conferencesScope === scope) return;
    this.conferencesScope = scope;
    this.conferencesUnsubscribe?.();
    const base = collection(this.db!, "conferences");
    this.conferencesUnsubscribe = onSnapshot(
      scope === "all" ? base : query(base, where("status", "in", ["live", "archived"])),
      (result) => {
        this.set({
          conferences: result.docs.map((item) => toConference(item.id, item.data())),
          conferencesLoading: false,
        });
      },
      (error) => {
        log.error("Conference list listener failed", { error: error.message });
        this.set({ conferencesLoading: false, error: "The conference list could not be loaded. Refresh to try again." });
      },
    );
  }

  private listenOrganizerData() {
    if (this.organizerUnsubscribers.length) return;
    this.organizerUnsubscribers = [
      onSnapshot(
        collection(this.db!, "platformRoles"),
        (result) =>
          this.set({
            organizers: result.docs
              .map((item) => ({ email: item.id, auditId: String(item.data().auditId ?? "") }))
              .sort((left, right) => left.email.localeCompare(right.email)),
          }),
        (error) => log.warn("Organizer list listener failed", { error: error.message }),
      ),
      onSnapshot(
        query(collection(this.db!, "platformAudit"), orderBy("at", "desc"), limit(50)),
        (result) =>
          this.set({
            audit: result.docs.map((item) => {
              const value = item.data();
              return { ...value, id: item.id, at: toMillis(value.at) } as AuditEntry;
            }),
          }),
        (error) => log.warn("Platform audit listener failed", { error: error.message }),
      ),
    ];
  }

  private async actor(): Promise<PlatformActor & { name: string }> {
    await this.ready;
    const user = this.auth?.currentUser;
    if (!user || user.isAnonymous || !user.email)
      throw new Error("Sign in with Google first.");
    return { uid: user.uid, email: user.email, name: user.displayName || user.email.split("@")[0] };
  }

  // Google sign-in upgrades an anonymous device account in place (keeping its
  // conference names and results), or switches to the existing Google account.
  async signIn() {
    await this.ready;
    const auth = this.auth!;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await this.run(async () => {
      const current = auth.currentUser;
      if (!current?.isAnonymous) {
        await signInWithPopup(auth, provider);
        return;
      }
      try {
        const linked = await linkWithPopup(current, provider);
        await this.handleUser(linked.user);
      } catch (error) {
        const inUse =
          error instanceof FirebaseError &&
          (error.code === "auth/credential-already-in-use" || error.code === "auth/email-already-in-use");
        if (!inUse) throw error;
        const credential = GoogleAuthProvider.credentialFromError(error);
        if (credential) await signInWithCredential(auth, credential);
        else await signInWithPopup(auth, provider);
      }
    });
  }

  async signOut() {
    await this.ready;
    if (this.auth) await signOut(this.auth);
  }

  async createConference(input: NewConferenceInput, onProgress?: (done: number, total: number) => void) {
    await this.run(async () => {
      const actor = await this.actor();
      if (this.snapshot.conferences.some((item) => item.id === input.slug))
        throw new Error("Another conference already uses this web address.");
      const plan = planConferenceCreation(input, actor, newAuditId);
      await commitConferenceCreation(this.db!, actor, plan, onProgress);
    });
  }

  async updateConference(conferenceId: string, changes: ConferenceChanges, reason?: string) {
    await this.run(async () => {
      const actor = await this.actor();
      const action = changes.status ? "setConferenceStatus" : "saveConference";
      await updateConference(
        this.db!,
        actor,
        conferenceId,
        changes,
        action,
        reason ?? (changes.status ? `Status changed to ${changes.status}` : "Conference details updated"),
      );
    });
  }

  async setDefaultConference(conferenceId: string) {
    await this.run(async () => setDefaultConference(this.db!, await this.actor(), conferenceId));
  }

  async setOrganizer(email: string, grant: boolean) {
    await this.run(async () => {
      await setOrganizerRole(this.db!, await this.actor(), email, grant);
    });
  }

  async setConferenceAdmin(conferenceId: string, email: string, grant: boolean) {
    await this.run(async () => {
      await setConferenceAdminRole(this.db!, await this.actor(), conferenceId, email, grant);
    });
  }

  watchConferenceAdmins(conferenceId: string, listener: (admins: RoleGrant[] | null, error?: string) => void) {
    let unsubscribe: Unsubscribe | undefined;
    let active = true;
    void this.ready.then(() => {
      if (!active || !this.db) return;
      unsubscribe = onSnapshot(
        collection(this.db, "conferences", conferenceId, "admins"),
        (result) =>
          listener(
            result.docs
              .map((item) => ({ email: item.id, auditId: String(item.data().auditId ?? "") }))
              .sort((left, right) => left.email.localeCompare(right.email)),
          ),
        (error) => listener(null, publicMessage(error)),
      );
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }

  async readCatalog(conferenceId: string) {
    return this.run(async () => {
      await this.ready;
      return readCatalog(this.db!, conferenceId);
    });
  }

  dispose() {
    this.disposed = true;
    this.revision += 1;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.roleUnsubscribe?.();
    this.conferencesUnsubscribe?.();
    this.organizerUnsubscribers.forEach((unsubscribe) => unsubscribe());
    super.dispose();
  }
}

const DEMO_ACTOR = { uid: "demo-operator", email: DEMO_ORGANIZER_EMAIL, name: "Demo organizer" };

/** ?demo=1: the platform lives in this browser; the demo operator is an organizer. */
class DemoPlatformStore extends BasePlatformStore {
  private organizer = true;
  private unsubscribe: () => void;
  constructor() {
    super("demo");
    this.refresh();
    this.unsubscribe = subscribeDemoPlatform(() => this.refresh());
  }
  private refresh() {
    const state = readDemoPlatform();
    this.set({
      identity: { uid: DEMO_ACTOR.uid, email: DEMO_ACTOR.email, name: DEMO_ACTOR.name, organizer: this.organizer },
      identityLoading: false,
      conferences: state.conferences
        .filter((item) => this.organizer || item.status !== "draft")
        .map(({ created: _created, ...conference }) => conference),
      conferencesLoading: false,
      defaultConferenceId: state.defaultConferenceId,
      organizers: this.organizer ? state.organizers : [],
      audit: this.organizer ? state.audit : [],
    });
  }
  private requireOrganizer() {
    if (!this.organizer) throw new Error("Organizer access is required.");
  }
  private audit(entry: Omit<AuditEntry, "id" | "actorUid" | "actorName" | "at">): AuditEntry {
    return { ...entry, id: newAuditId(), actorUid: DEMO_ACTOR.uid, actorName: DEMO_ACTOR.email, at: Date.now() };
  }
  async signIn() {
    this.organizer = true;
    this.refresh();
  }
  async signOut() {
    this.organizer = false;
    this.refresh();
  }
  async createConference(input: NewConferenceInput, onProgress?: (done: number, total: number) => void) {
    await this.run(async () => {
      this.requireOrganizer();
      if (readDemoPlatform().conferences.some((item) => item.id === input.slug))
        throw new Error("Another conference already uses this web address.");
      const plan = planConferenceCreation(input, DEMO_ACTOR, newAuditId);
      const at = Date.now();
      const writes = plan.chunks.flat().map((pair) => resolveServerTime(pair, at));
      const catalog = copyCatalog(input);
      const state: ConferenceState = {
        categories: catalog.categories,
        events: catalog.events,
        participants: [],
        teams: [],
        attempts: [],
        brackets: [],
        games: [],
        audit: writes.map(({ audit }) => ({ ...audit.data, id: audit.path.at(-1)! }) as AuditEntry).reverse(),
      };
      try {
        localStorage.setItem(demoStateKey(plan.conferenceId), JSON.stringify(state));
      } catch {
        /* storage may be disabled */
      }
      const admins = writes
        .filter(({ target }) => target.path[2] === "admins")
        .map(({ target }) => ({ email: String(target.data.email), auditId: String(target.data.auditId) }));
      writeDemoPlatform((current) => ({
        ...current,
        conferences: [
          ...current.conferences,
          {
            id: plan.conferenceId,
            slug: plan.conferenceId,
            name: input.name.trim(),
            startDate: input.startDate,
            endDate: input.endDate,
            location: input.location.trim(),
            status: input.status,
            createdAt: at,
            created: true,
          },
        ],
        admins: { ...current.admins, [plan.conferenceId]: admins },
        audit: [
          this.audit({
            action: "createConference",
            entityType: "conference",
            entityId: plan.conferenceId,
            before: null,
            after: plan.conference,
            reason: `New conference (${input.sourceLabel})`,
          }),
          ...current.audit,
        ],
      }));
      onProgress?.(1, 1);
    });
  }
  async updateConference(conferenceId: string, changes: ConferenceChanges) {
    await this.run(async () => {
      const before = readDemoPlatform().conferences.find((item) => item.id === conferenceId);
      if (!before) throw new Error("Conference not found.");
      if (changes.status && !this.organizer) throw new Error("Only organizers can change a conference's status.");
      const after = {
        ...before,
        ...(changes.name !== undefined && { name: changes.name.trim() }),
        ...(changes.startDate !== undefined && { startDate: changes.startDate }),
        ...(changes.endDate !== undefined && { endDate: changes.endDate }),
        ...(changes.location !== undefined && { location: changes.location.trim() }),
        ...(changes.status && { status: changes.status }),
      };
      const error = detailsError(after);
      if (error) throw new Error(error);
      writeDemoPlatform((current) => ({
        ...current,
        conferences: current.conferences.map((item) => (item.id === conferenceId ? after : item)),
        audit: [
          this.audit({
            action: changes.status ? "setConferenceStatus" : "saveConference",
            entityType: "conference",
            entityId: conferenceId,
            before,
            after,
            reason: changes.status ? `Status changed to ${changes.status}` : "Conference details updated",
          }),
          ...current.audit,
        ],
      }));
    });
  }
  async setDefaultConference(conferenceId: string) {
    await this.run(async () => {
      this.requireOrganizer();
      writeDemoPlatform((current) => ({
        ...current,
        defaultConferenceId: conferenceId,
        audit: [
          this.audit({
            action: "setDefaultConference",
            entityType: "settings",
            entityId: "platform",
            before: { defaultConferenceId: current.defaultConferenceId },
            after: { defaultConferenceId: conferenceId },
            reason: "Default conference changed",
          }),
          ...current.audit,
        ],
      }));
    });
  }
  private changeRole(
    list: RoleGrant[],
    email: string,
    grant: boolean,
    entityType: string,
    action: string,
  ): { list: RoleGrant[]; entry?: AuditEntry } {
    const error = emailError(email);
    if (error) throw new Error(error);
    const key = normalizeEmail(email);
    const existing = list.find((item) => item.email === key);
    if (grant === Boolean(existing)) return { list };
    if (grant) {
      const role = { email: key, auditId: newAuditId() };
      return {
        list: [...list, role].sort((left, right) => left.email.localeCompare(right.email)),
        entry: this.audit({ action, entityType, entityId: key, before: null, after: role, reason: "Role granted in the app" }),
      };
    }
    return {
      list: list.filter((item) => item.email !== key),
      entry: this.audit({ action, entityType, entityId: key, before: existing, after: null, reason: "Role revoked in the app" }),
    };
  }
  async setOrganizer(email: string, grant: boolean) {
    await this.run(async () => {
      this.requireOrganizer();
      const current = readDemoPlatform();
      const listed = current.organizers.map((item) => item.email);
      if (!grant && removesLastOrganizer(listed, email)) throw new Error(LAST_ORGANIZER_ERROR);
      const change = this.changeRole(current.organizers, email, grant, "platformRoles", grant ? "grantOrganizer" : "revokeOrganizer");
      if (!change.entry) return;
      writeDemoPlatform((state) => ({ ...state, organizers: change.list, audit: [change.entry!, ...state.audit] }));
    });
  }
  async setConferenceAdmin(conferenceId: string, email: string, grant: boolean) {
    await this.run(async () => {
      this.requireOrganizer();
      const current = readDemoPlatform();
      const conference = current.conferences.find((item) => item.id === conferenceId);
      if (conference?.status === "archived") throw new Error("This conference is archived. Unarchive it to change its admins.");
      const change = this.changeRole(current.admins[conferenceId] ?? [], email, grant, "admins", grant ? "grantAdmin" : "revokeAdmin");
      if (!change.entry) return;
      writeDemoPlatform((state: DemoPlatformState) => ({
        ...state,
        admins: { ...state.admins, [conferenceId]: change.list },
        audit: [change.entry!, ...state.audit],
      }));
    });
  }
  watchConferenceAdmins(conferenceId: string, listener: (admins: RoleGrant[] | null, error?: string) => void) {
    const emit = () => listener(readDemoPlatform().admins[conferenceId] ?? []);
    emit();
    return subscribeDemoPlatform(emit);
  }
  async readCatalog(conferenceId: string) {
    const created = readDemoPlatform().conferences.find((item) => item.id === conferenceId)?.created;
    if (created) {
      try {
        const saved = localStorage.getItem(demoStateKey(conferenceId));
        if (saved) return copyCatalog(JSON.parse(saved) as ConferenceState);
      } catch {
        /* fall back to the built-in catalog */
      }
    }
    // Sample conferences use the built-in catalog.
    return copyCatalog({ categories: initialCategories, events: initialEvents });
  }
  dispose() {
    this.unsubscribe();
    super.dispose();
  }
}

export function createPlatformStore(demo: boolean): PlatformStore {
  return demo ? new DemoPlatformStore() : new FirebasePlatformStore();
}
