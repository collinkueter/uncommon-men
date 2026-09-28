import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ConferenceStore } from '@/domain/types';
import { LazyConferenceStore } from '@/lib/lazyStore';

const Context = createContext<ConferenceStore | null>(null);
// One live store at a time: the conference in the current route. Switching to
// another conference (or in or out of demo mode) disposes the previous store.
let active: { key: string; store: ConferenceStore } | undefined;
const isDemo = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

export function storeFor(conferenceId: string): ConferenceStore {
  const demo = isDemo();
  const key = `${conferenceId}|${demo ? 'demo' : 'live'}`;
  if (active?.key !== key) {
    active?.store.dispose();
    active = {
      key,
      store: new LazyConferenceStore(
        conferenceId,
        () => import('@/data/store').then(({ createConferenceStore }) => createConferenceStore(conferenceId)),
        demo,
      ),
    };
  }
  return active.store;
}

/** Provides the store for `conferenceId`, which comes from the /c/:slug route. */
export function ConferenceProvider({ conferenceId, children }: { conferenceId: string; children: ReactNode }) {
  const store = storeFor(conferenceId);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useConference() {
  const store = useContext(Context);
  if (!store) throw new Error('ConferenceProvider is required.');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, snapshot, execute: store.execute.bind(store), signInWithGoogle: store.signInWithGoogle.bind(store), signInAdmin: store.signInAdmin.bind(store), signOutAdmin: store.signOutAdmin.bind(store), clearError: store.clearError.bind(store) };
}
if (import.meta.hot) import.meta.hot.dispose(() => { active?.store.dispose(); active = undefined; });
