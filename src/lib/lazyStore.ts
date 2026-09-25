import type { AppSnapshot, Command, ConferenceStore } from "@/domain/types";
import { log } from "@/lib/logging/logger";

// Stands in for the real store while the Firebase SDK downloads, so the app
// shell paints on slow venue networks instead of waiting on ~140 KB of Firestore.
export class LazyConferenceStore implements ConferenceStore {
  private real: ConferenceStore | undefined;
  private disposed = false;
  private listeners = new Set<() => void>();
  private pending: AppSnapshot;
  private ready: Promise<ConferenceStore>;

  constructor(load: () => Promise<ConferenceStore>, demo: boolean) {
    this.pending = {
      data: { categories: [], events: [], participants: [], teams: [], attempts: [], brackets: [], games: [], audit: [] },
      identity: null,
      loading: true,
      error: null,
      mode: demo ? "demo" : "firebase",
      connected: true,
    };
    this.ready = load();
    this.ready.then(
      (store) => {
        if (this.disposed) return store.dispose();
        this.real = store;
        store.subscribe(this.emit);
        this.emit();
      },
      (error: unknown) => {
        log.error("Conference store failed to load", { error: String(error) });
        this.pending = {
          ...this.pending,
          loading: false,
          error: "The app could not finish loading. Check your connection and refresh.",
        };
        this.emit();
      },
    );
  }

  private emit = () => this.listeners.forEach((listener) => listener());

  getSnapshot = () => this.real?.getSnapshot() ?? this.pending;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async execute(command: Command) {
    return (await this.ready).execute(command);
  }
  async signInWithGoogle(preferredName?: string) {
    return (await this.ready).signInWithGoogle(preferredName);
  }
  async signInAdmin() {
    return (await this.ready).signInAdmin();
  }
  async signOutAdmin() {
    return (await this.ready).signOutAdmin();
  }
  clearError() {
    if (this.real) return this.real.clearError();
    this.pending = { ...this.pending, error: null };
    this.emit();
  }
  dispose() {
    this.disposed = true;
    this.real?.dispose();
  }
}
