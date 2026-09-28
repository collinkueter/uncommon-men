// Pure conference and role logic shared by the organizer UI, the platform
// stores and the rules tests: slug and email validation, directory ordering,
// and the audited write plan for creating a conference.
import type { Category, Competition, Conference, ConferenceStatus, PlatformSnapshot, RoleGrant } from "./types";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 60;
/** The rules also require at least two characters (`^[a-z0-9][a-z0-9-]{1,62}$`). */
export const SLUG_MIN_LENGTH = 2;
export const CONFERENCE_NAME_MAX = 100;
export const LOCATION_MAX = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A URL slug suggested from a conference name: "Fall Retreat 2027!" -> "fall-retreat-2027". */
export function suggestSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
}

/** An error message, or null when `slug` is a valid, unused conference address. */
export function slugError(slug: string, existingIds: Iterable<string> = []): string | null {
  if (!slug) return "Enter a web address for the conference.";
  if (slug.length > SLUG_MAX_LENGTH) return `The web address must be ${SLUG_MAX_LENGTH} characters or fewer.`;
  if (slug.length < SLUG_MIN_LENGTH) return `The web address must be at least ${SLUG_MIN_LENGTH} characters.`;
  if (!SLUG_PATTERN.test(slug))
    return "Use lowercase letters and numbers, separated by single hyphens (for example fall-retreat-2027).";
  for (const id of existingIds) if (id === slug) return "Another conference already uses this web address.";
  return null;
}

/** Role documents are keyed by the trimmed, lowercased Google email. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
export function emailError(value: string): string | null {
  const email = normalizeEmail(value);
  if (!email) return "Enter a Google account email.";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return `${value.trim()} is not a valid email address.`;
  return null;
}

/** Splits a comma, semicolon, space or newline separated list into unique normalized emails. */
export function parseEmailList(value: string): { emails: string[]; errors: string[] } {
  const emails: string[] = [];
  const errors: string[] = [];
  for (const raw of value.split(/[\s,;]+/)) {
    if (!raw.trim()) continue;
    const error = emailError(raw);
    if (error) errors.push(error);
    else if (!emails.includes(normalizeEmail(raw))) emails.push(normalizeEmail(raw));
  }
  return { emails, errors };
}

export interface ConferenceDetails {
  name: string;
  startDate: string;
  endDate: string;
  location: string;
}

/** An error message, or null when the descriptive fields satisfy the rules. */
export function detailsError(details: ConferenceDetails): string | null {
  const name = details.name.trim();
  if (!name) return "Enter the conference name.";
  if (name.length > CONFERENCE_NAME_MAX) return `The name must be ${CONFERENCE_NAME_MAX} characters or fewer.`;
  if (!ISO_DATE.test(details.startDate) || !ISO_DATE.test(details.endDate)) return "Enter a start and end date.";
  if (details.startDate > details.endDate) return "The end date cannot be before the start date.";
  if (details.location.trim().length > LOCATION_MAX) return `The location must be ${LOCATION_MAX} characters or fewer.`;
  return null;
}

export const cleanDetails = (details: ConferenceDetails): ConferenceDetails => ({
  name: details.name.trim(),
  startDate: details.startDate,
  endDate: details.endDate,
  location: details.location.trim(),
});

/** Organizer status moves: draft -> live -> archived, and archived back to live. */
export function statusAction(status: ConferenceStatus): { to: ConferenceStatus; label: string } {
  if (status === "draft") return { to: "live", label: "Publish" };
  if (status === "live") return { to: "archived", label: "Archive" };
  return { to: "live", label: "Unarchive" };
}

// Directory ------------------------------------------------------------------

export interface DirectorySections {
  current: Conference[];
  past: Conference[];
  drafts: Conference[];
}

/**
 * The home page directory: live conferences first (soonest start first), then
 * archived ones as "Past conferences" (most recent first). Drafts are listed
 * separately and only for viewers who can read them.
 */
export function directorySections(conferences: Conference[], showDrafts: boolean, query = ""): DirectorySections {
  const matches = filterConferences(conferences, query);
  const byStart = (a: Conference, b: Conference) =>
    a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name);
  const byRecent = (a: Conference, b: Conference) =>
    b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name);
  return {
    current: matches.filter((item) => item.status === "live").sort(byStart),
    past: matches.filter((item) => item.status === "archived").sort(byRecent),
    drafts: showDrafts ? matches.filter((item) => item.status === "draft").sort(byStart) : [],
  };
}

/** Case- and accent-insensitive match on name, address and location. */
export function filterConferences(conferences: Conference[], query: string): Conference[] {
  const fold = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return conferences;
  return conferences.filter((item) => {
    const haystack = fold(`${item.name} ${item.slug} ${item.location}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/** Show the directory filter once the list is long enough to need it. */
export const DIRECTORY_FILTER_THRESHOLD = 6;

/** "Oct 1 – 3, 2027", "Sep 30 – Oct 2, 2027", "Dec 30, 2027 – Jan 2, 2028". */
export function formatDateRange(startDate: string, endDate: string): string {
  if (!ISO_DATE.test(startDate)) return "";
  const parse = (value: string) => new Date(`${value}T12:00:00Z`);
  const start = parse(startDate);
  const end = ISO_DATE.test(endDate) ? parse(endDate) : start;
  const month = (date: Date) => date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = (date: Date) => date.getUTCDate();
  const year = (date: Date) => date.getUTCFullYear();
  if (startDate === endDate || end <= start) return `${month(start)} ${day(start)}, ${year(start)}`;
  if (year(start) !== year(end))
    return `${month(start)} ${day(start)}, ${year(start)} – ${month(end)} ${day(end)}, ${year(end)}`;
  if (month(start) !== month(end)) return `${month(start)} ${day(start)} – ${month(end)} ${day(end)}, ${year(end)}`;
  return `${month(start)} ${day(start)} – ${day(end)}, ${year(end)}`;
}

// Creation plan ---------------------------------------------------------------

/** Stands for the server's commit time; `resolveServerTime` swaps it for serverTimestamp() or Date.now(). */
export const SERVER_TIME = Object.freeze({ __serverTime: true } as const);
export type ServerTime = typeof SERVER_TIME;

export function resolveServerTime<T>(value: T, replacement: unknown): T {
  if (value === (SERVER_TIME as unknown)) return replacement as T;
  if (Array.isArray(value)) return value.map((item) => resolveServerTime(item, replacement)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = resolveServerTime(item, replacement);
    return result as T;
  }
  return value;
}

export interface PlannedWrite {
  /** Firestore path segments, e.g. ["conferences", "fall-2027", "events", "push-up"]. */
  path: string[];
  data: Record<string, unknown>;
}
/** A document and the audit entry that vouches for it; always committed together. */
export interface WritePair {
  target: PlannedWrite;
  audit: PlannedWrite;
}

export interface CatalogCopy {
  categories: Category[];
  events: Competition[];
}

/**
 * Only the catalog of a conference is ever copied: whitelisted category and
 * event fields. Participants, teams, results, brackets, games, identities and
 * audit history never are, whatever else `source` carries.
 */
export function copyCatalog(source: { categories: Category[]; events: Competition[] }): CatalogCopy {
  return {
    categories: source.categories.map((category) => ({
      id: category.id,
      name: category.name,
      group: category.group,
      order: category.order,
    })),
    events: source.events.map((event) => ({
      id: event.id,
      categoryId: event.categoryId,
      name: event.name,
      kind: event.kind,
      direction: event.direction,
      unit: event.unit,
      team: event.team,
      teamSize: event.teamSize,
      instructions: event.instructions,
      active: event.active,
    })),
  };
}

export interface NewConferenceInput extends ConferenceDetails {
  slug: string;
  /** The status the conference ends up in. It is created as a draft and published last. */
  status: "draft" | "live";
  /** Every category is copied so the event editor can use them later. */
  categories: Category[];
  /** Only the selected events. */
  events: Competition[];
  adminEmails: string[];
  /** Where the catalog came from, for the audit reason. */
  sourceLabel: string;
}

export interface PlanActor {
  uid: string;
  /** The Google email exactly as in the ID token (conference and role audits must match it). */
  email: string;
  /** The actor's name in the new conference (its identity document), required for catalog audits. */
  name: string;
}

export interface ConferenceCreationPlan {
  conferenceId: string;
  /** Committed in order; each chunk is one batch, and each pair stays in one chunk. */
  chunks: WritePair[][];
  /** When the requested status is live, the draft is published after every chunk succeeds. */
  publish: boolean;
  conference: Record<string, unknown>;
}

/**
 * Security rules allow about 20 document lookups per batch, and every audited
 * pair costs two besides the shared conference, role and identity documents.
 */
export const PAIRS_PER_CHUNK = 5;

/**
 * The audited writes that create a conference: the conference document, the
 * creator's identity in it (catalog audits must name a conference identity),
 * the initial admins, then categories and events. Every audit follows the
 * rules exactly: `after` equals the written document and names its auditId.
 */
export function planConferenceCreation(
  input: NewConferenceInput,
  actor: PlanActor,
  newId: () => string,
): ConferenceCreationPlan {
  const error = slugError(input.slug) ?? detailsError(input);
  if (error) throw new Error(error);
  if (!actor.email) throw new Error("Sign in with a verified Google account to create conferences.");
  const cid = input.slug;
  const details = cleanDetails(input);
  const base = ["conferences", cid];
  const reason = `New conference (${input.sourceLabel})`.slice(0, 500);
  const pair = (
    target: string[],
    after: Record<string, unknown>,
    action: string,
    entityType: string,
    entityId: string,
    actorName: string,
    auditReason = reason,
  ): WritePair => {
    const auditId = newId();
    const data = { ...after, auditId };
    return {
      target: { path: target, data },
      audit: {
        path: [...base, "audit", auditId],
        data: {
          action,
          entityType,
          entityId,
          actorUid: actor.uid,
          actorName,
          at: SERVER_TIME,
          before: null,
          after: data,
          reason: auditReason,
        },
      },
    };
  };

  const conferencePair = pair(
    base,
    { ...details, slug: cid, status: "draft", createdAt: SERVER_TIME },
    "createConference",
    "conference",
    cid,
    actor.email,
  );
  const hasCatalog = input.categories.length > 0 || input.events.length > 0;
  const first: WritePair[] = [conferencePair];
  if (hasCatalog) {
    const name = actor.name.trim().slice(0, 80) || actor.email.slice(0, 80);
    first.push(
      pair(
        [...base, "identities", actor.uid],
        { uid: actor.uid, name, participantId: null },
        "identity",
        "identities",
        actor.uid,
        name,
        "Conference creator",
      ),
    );
  }
  const identityName = hasCatalog ? String(first[1].target.data.name) : "";
  const adminEmails = [...new Set(input.adminEmails.map(normalizeEmail))];
  for (const email of adminEmails) {
    const error = emailError(email);
    if (error) throw new Error(error);
  }
  const rest: WritePair[] = [
    ...adminEmails.map((email) =>
      pair([...base, "admins", email], { email }, "grantAdmin", "admins", email, actor.email, "Initial conference admin"),
    ),
    ...copyCatalog(input).categories.map(({ id, ...category }) =>
      pair([...base, "categories", id], category, "createCategory", "categories", id, identityName),
    ),
    ...copyCatalog(input).events.map(({ id, ...event }) =>
      pair([...base, "events", id], event, "createEvent", "events", id, identityName),
    ),
  ];
  const chunks: WritePair[][] = [first];
  for (let index = 0; index < rest.length; index += PAIRS_PER_CHUNK)
    chunks.push(rest.slice(index, index + PAIRS_PER_CHUNK));
  return { conferenceId: cid, chunks, publish: input.status === "live", conference: conferencePair.target.data };
}

export type ConferenceChanges = Partial<ConferenceDetails> & { status?: ConferenceStatus };

/** Organizer and conference-admin commands, plus the platform data they act on. */
export interface PlatformStore {
  getSnapshot(): PlatformSnapshot;
  subscribe(listener: () => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  createConference(input: NewConferenceInput, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Conference admins may change details of a non-archived conference; status is organizer-only. */
  updateConference(conferenceId: string, changes: ConferenceChanges, reason?: string): Promise<void>;
  setDefaultConference(conferenceId: string): Promise<void>;
  setOrganizer(email: string, grant: boolean): Promise<void>;
  setConferenceAdmin(conferenceId: string, email: string, grant: boolean): Promise<void>;
  /** Live list of conferences/{cid}/admins; `null` with a message when it cannot be read. */
  watchConferenceAdmins(conferenceId: string, listener: (admins: RoleGrant[] | null, error?: string) => void): () => void;
  /** A conference's categories and events, for copying into a new conference. */
  readCatalog(conferenceId: string): Promise<CatalogCopy>;
  clearError(): void;
  dispose(): void;
}
