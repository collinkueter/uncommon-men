// The conference this browser last opened, so pages outside any conference
// (the directory and the organizer area) keep the same navigation back into it.
export interface RememberedConference {
  id: string;
  name: string;
}

const key = (demo: boolean) => `uncommon-men:last-conference${demo ? ":demo" : ""}`;

export function readLastConference(demo: boolean): RememberedConference | undefined {
  try {
    const raw = window.localStorage.getItem(key(demo));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<RememberedConference>;
    return typeof value.id === "string" && typeof value.name === "string"
      ? { id: value.id, name: value.name }
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberConference(demo: boolean, conference: RememberedConference) {
  try {
    window.localStorage.setItem(key(demo), JSON.stringify(conference));
  } catch {
    // Storage may be blocked; navigation falls back to the default conference.
  }
}
