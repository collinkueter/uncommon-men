import { DEFAULT_CONFERENCE_ID } from '@/lib/conferencePaths';

let lookup: Promise<string> | undefined;
let resolved: string | undefined;
const isDemo = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

/** The default conference id if it is already known (demo mode, or after one lookup). */
export function peekDefaultConferenceId(): string | undefined {
  return isDemo() ? DEFAULT_CONFERENCE_ID : resolved;
}

/** settings/platform.defaultConferenceId, read once per page; the constant in demo mode or on failure. */
export function loadDefaultConferenceId(): Promise<string> {
  if (isDemo()) return Promise.resolve(DEFAULT_CONFERENCE_ID);
  return (lookup ??= import('@/data/firebase')
    .then(({ readDefaultConferenceId }) => readDefaultConferenceId())
    .catch(() => DEFAULT_CONFERENCE_ID)
    .then((id) => (resolved = id)));
}
