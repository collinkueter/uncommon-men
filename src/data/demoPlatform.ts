// Browser-local stand-in for the platform data (conferences, settings/platform,
// platformRoles, conference admins, platformAudit) used by ?demo=1. Like the
// demo conference data, it never touches Firebase.
import type { AuditEntry, Conference } from "@/domain/types";
import { DEFAULT_CONFERENCE_ID } from "@/lib/conferencePaths";

export const DEMO_PLATFORM_KEY = "uncommon-men.demo-platform.v1";
export const DEMO_ORGANIZER_EMAIL = "demo@example.com";

export interface DemoRole {
  email: string;
  auditId: string;
}

export interface DemoConference extends Conference {
  /** Created on /organizer in this browser: its catalog is stored, not the sample catalog. */
  created?: boolean;
}

export interface DemoPlatformState {
  conferences: DemoConference[];
  defaultConferenceId: string;
  organizers: DemoRole[];
  admins: Record<string, DemoRole[]>;
  audit: AuditEntry[];
}

export function demoPlatformSeed(): DemoPlatformState {
  return {
    conferences: [
      {
        id: DEFAULT_CONFERENCE_ID,
        slug: DEFAULT_CONFERENCE_ID,
        name: "Uncommon Men 2026",
        startDate: "2026-09-22",
        endDate: "2026-09-24",
        location: "Sample venue",
        status: "live",
      },
      {
        id: "uncommon-men-2025",
        slug: "uncommon-men-2025",
        name: "Uncommon Men 2025",
        startDate: "2025-09-23",
        endDate: "2025-09-25",
        location: "Sample venue",
        status: "archived",
      },
    ],
    defaultConferenceId: DEFAULT_CONFERENCE_ID,
    organizers: [{ email: DEMO_ORGANIZER_EMAIL, auditId: "demo-seed-organizer" }],
    admins: {},
    audit: [],
  };
}

let cached: DemoPlatformState | undefined;
const listeners = new Set<() => void>();

export function readDemoPlatform(): DemoPlatformState {
  if (cached) return cached;
  let state = demoPlatformSeed();
  try {
    const raw = localStorage.getItem(DEMO_PLATFORM_KEY);
    if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<DemoPlatformState>) };
  } catch {
    /* storage may be disabled */
  }
  cached = state;
  return state;
}

export function writeDemoPlatform(update: (state: DemoPlatformState) => DemoPlatformState) {
  cached = update(readDemoPlatform());
  try {
    localStorage.setItem(DEMO_PLATFORM_KEY, JSON.stringify(cached));
  } catch {
    /* storage may be disabled */
  }
  listeners.forEach((listener) => listener());
}

export function subscribeDemoPlatform(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function findDemoConference(conferenceId: string): DemoConference | undefined {
  return readDemoPlatform().conferences.find((item) => item.id === conferenceId);
}

/** For tests. */
export function resetDemoPlatformCache() {
  cached = undefined;
}
