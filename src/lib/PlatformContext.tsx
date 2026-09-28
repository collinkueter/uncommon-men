import { useSyncExternalStore } from 'react';
import type { ConferenceChanges, NewConferenceInput, PlatformStore } from '@/domain/conferences';
import type { PlatformSnapshot, RoleGrant } from '@/domain/types';
import { log } from '@/lib/logging/logger';

const isDemo = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

// Stands in for the platform store while the Firebase SDK downloads, like
// LazyConferenceStore, so the directory paints before Firestore arrives.
class LazyPlatformStore implements PlatformStore {
  private real: PlatformStore | undefined;
  private disposed = false;
  private listeners = new Set<() => void>();
  private pending: PlatformSnapshot;
  private ready: Promise<PlatformStore>;

  constructor(demo: boolean) {
    this.pending = {
      mode: demo ? 'demo' : 'firebase',
      identity: null,
      identityLoading: true,
      conferences: [],
      conferencesLoading: true,
      defaultConferenceId: null,
      organizers: [],
      audit: [],
      error: null,
    };
    this.ready = import('@/data/platform').then(({ createPlatformStore }) => createPlatformStore(demo));
    this.ready.then(
      (store) => {
        if (this.disposed) return store.dispose();
        this.real = store;
        store.subscribe(this.emit);
        this.emit();
      },
      (error: unknown) => {
        log.error('Platform store failed to load', { error: String(error) });
        this.pending = {
          ...this.pending,
          identityLoading: false,
          conferencesLoading: false,
          error: 'The app could not finish loading. Check your connection and refresh.',
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
  async signIn() { return (await this.ready).signIn(); }
  async signOut() { return (await this.ready).signOut(); }
  async createConference(input: NewConferenceInput, onProgress?: (done: number, total: number) => void) {
    return (await this.ready).createConference(input, onProgress);
  }
  async updateConference(conferenceId: string, changes: ConferenceChanges, reason?: string) {
    return (await this.ready).updateConference(conferenceId, changes, reason);
  }
  async setDefaultConference(conferenceId: string) { return (await this.ready).setDefaultConference(conferenceId); }
  async setOrganizer(email: string, grant: boolean) { return (await this.ready).setOrganizer(email, grant); }
  async setConferenceAdmin(conferenceId: string, email: string, grant: boolean) {
    return (await this.ready).setConferenceAdmin(conferenceId, email, grant);
  }
  watchConferenceAdmins(conferenceId: string, listener: (admins: RoleGrant[] | null, error?: string) => void) {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    void this.ready.then((store) => {
      if (active) unsubscribe = store.watchConferenceAdmins(conferenceId, listener);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }
  async readCatalog(conferenceId: string) { return (await this.ready).readCatalog(conferenceId); }
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

// One platform store per page and mode; it holds page-wide listeners (the
// conference list, the viewer's organizer role) shared by every screen.
let active: { demo: boolean; store: PlatformStore } | undefined;

export function platformStore(): PlatformStore {
  const demo = isDemo();
  if (active?.demo !== demo) {
    active?.store.dispose();
    active = { demo, store: new LazyPlatformStore(demo) };
  }
  return active.store;
}

/** Platform data (conferences, roles, default conference) and organizer commands. */
export function usePlatform() {
  const store = platformStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { snapshot, store };
}

if (import.meta.hot) import.meta.hot.dispose(() => { active?.store.dispose(); active = undefined; });
