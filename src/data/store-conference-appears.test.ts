import { afterEach, describe, expect, it, vi } from "vitest";

// A visitor who opens a conference before its document exists (for example in
// the deploy window before the multi-conference migration ran) gets
// permission-denied on every subcollection. Once the conference document
// appears, those listeners must be re-opened without a reload.
type Listener = { path: string; next: (value: unknown) => void; error: (error: unknown) => void };
const firestore = vi.hoisted(() => ({ listeners: [] as Listener[] }));

vi.mock("./firebase", () => ({
  getFirebaseServices: () => ({ auth: {}, db: {}, ready: Promise.resolve() }),
}));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  getIdTokenResult: vi.fn(),
  linkWithPopup: vi.fn(),
  onAuthStateChanged: () => () => undefined,
  signInAnonymously: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  Timestamp: class {},
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  getDoc: vi.fn(),
  getDocFromCache: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: (ref: { path: string }, ...rest: unknown[]) => {
    const callbacks = rest.filter((item) => typeof item === "function") as Listener["next"][];
    firestore.listeners.push({ path: ref.path, next: callbacks[0], error: callbacks[1] });
    return () => undefined;
  },
}));

const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
const snapshot = (docs: { id: string; data: Record<string, unknown> }[]) => ({
  metadata: { fromCache: false },
  docs: docs.map((item) => ({ id: item.id, data: () => item.data })),
  docChanges: () => docs,
});

afterEach(() => {
  firestore.listeners.length = 0;
  vi.unstubAllGlobals();
});

describe("FirebaseStore when the conference document appears later", () => {
  it("re-opens subcollection listeners that were denied while it was missing", async () => {
    vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined, location: { search: "" } });
    vi.stubGlobal("navigator", { onLine: true });
    const { createConferenceStore } = await import("./store");
    const store = await createConferenceStore("uncommon-men-2026");
    await vi.waitFor(() => expect(firestore.listeners.length).toBeGreaterThan(1));

    const conference = firestore.listeners.find((item) => item.path === "conferences/uncommon-men-2026")!;
    const events = () => firestore.listeners.filter((item) => item.path === "conferences/uncommon-men-2026/events");
    conference.next({ metadata: { fromCache: false }, exists: () => false });
    for (const listener of [...firestore.listeners]) if (listener !== conference) listener.error(denied);
    expect(store.getSnapshot().conferenceState).toBe("missing");
    expect(events()).toHaveLength(1);

    conference.next({
      metadata: { fromCache: false },
      exists: () => true,
      id: "uncommon-men-2026",
      data: () => ({ name: "Uncommon Men 2026", slug: "uncommon-men-2026", status: "live", startDate: "2026-10-02", endDate: "2026-10-04", location: "" }),
    });
    expect(store.getSnapshot().conferenceState).toBe("ready");
    expect(events()).toHaveLength(2);
    events()[1].next(snapshot([{ id: "push-up", data: { name: "Push-up", categoryId: "c", kind: "count", active: true } }]));
    expect(store.getSnapshot().data.events.map((event) => event.id)).toEqual(["push-up"]);
    store.dispose();
  });
});
