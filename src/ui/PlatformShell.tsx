import type { ReactNode } from "react";
import { X } from "lucide-react";
import { usePlatform } from "@/lib/PlatformContext";
import { readLastConference } from "@/lib/lastConference";
import type { PlatformSnapshot } from "@/domain/types";
import { SiteShell, type ShellConference } from "./SiteShell";

/**
 * The conference the header points into outside any conference: the one this
 * browser last opened, else (when `useDefault`) the platform default. A
 * remembered conference that is no longer listed is dropped.
 */
function navConference(snapshot: PlatformSnapshot, useDefault: boolean): ShellConference | undefined {
  const listed = (id: string) => snapshot.conferences.find((conference) => conference.id === id);
  const remembered = readLastConference(snapshot.mode === "demo");
  if (remembered) {
    const current = listed(remembered.id);
    if (current) return { id: current.id, name: current.name };
    if (snapshot.conferencesLoading) return remembered;
  }
  const fallback = useDefault && snapshot.defaultConferenceId ? listed(snapshot.defaultConferenceId) : undefined;
  return fallback && { id: fallback.id, name: fallback.name };
}

/** Page chrome outside any conference: the directory and the organizer area. */
export function PlatformShell({ children, useDefault = false }: { children: ReactNode; useDefault?: boolean }) {
  const { snapshot, store } = usePlatform();
  const identity = snapshot.identity;
  // Anonymous sessions (every competitor) have no account name to show.
  const name = identity?.email ? identity.name : undefined;
  const notices = snapshot.error ? (
    <div className="notice error" role="alert">
      {snapshot.error}
      <button onClick={() => store.clearError()} aria-label="Dismiss notification">
        <X />
      </button>
    </div>
  ) : (
    snapshot.mode === "demo" && (
      <div className="notice demo" role="status">DEMO MODE · Sample conferences stored in this browser</div>
    )
  );
  return (
    <SiteShell
      conference={navConference(snapshot, useDefault)}
      organizer={identity?.organizer}
      profile={name ? { name } : undefined}
      notices={notices}
    >
      {children}
    </SiteShell>
  );
}
