import { DEFAULT_CONFERENCE_ID } from '@/lib/conferencePaths';
import { readDemoPlatform } from '@/data/demoPlatform';

let lookup: Promise<string> | undefined;
let resolved: string | undefined;
const isDemo = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

/** The default conference id if it is already known (demo mode, or after one lookup). */
export function peekDefaultConferenceId(): string | undefined {
  return isDemo() ? readDemoPlatform().defaultConferenceId : resolved;
}

/** settings/platform.defaultConferenceId, read once per page; the demo platform's default in demo mode, the constant on failure. */
export function loadDefaultConferenceId(): Promise<string> {
  if (isDemo()) return Promise.resolve(readDemoPlatform().defaultConferenceId);
  return (lookup ??= import('@/data/firebase')
    .then(({ readDefaultConferenceId }) => readDefaultConferenceId())
    .catch(() => DEFAULT_CONFERENCE_ID)
    .then((id) => (resolved = id)));
}
