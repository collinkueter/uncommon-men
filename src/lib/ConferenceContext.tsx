import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ConferenceStore } from '@/domain/types';
import { LazyConferenceStore } from '@/lib/lazyStore';

const Context = createContext<ConferenceStore | null>(null);
let activeStore: ConferenceStore | undefined;
const isDemo = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
export function ConferenceProvider({ children }: { children: ReactNode }) {
  const store = activeStore ??= new LazyConferenceStore(() => import('@/data/store').then(({ createConferenceStore }) => createConferenceStore()), isDemo());
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useConference() {
  const store = useContext(Context);
  if (!store) throw new Error('ConferenceProvider is required.');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, snapshot, execute: store.execute.bind(store), signInWithGoogle: store.signInWithGoogle.bind(store), signInAdmin: store.signInAdmin.bind(store), signOutAdmin: store.signOutAdmin.bind(store), clearError: store.clearError.bind(store) };
}
if (import.meta.hot) import.meta.hot.dispose(() => { activeStore?.dispose(); activeStore = undefined; });
