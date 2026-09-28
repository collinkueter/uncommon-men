export type ScoreKind = 'count' | 'duration' | 'distance' | 'bracket' | 'knockout';
export type Direction = 'higher' | 'lower';
export interface Category { id: string; name: string; group: 'physical' | 'mental'; order: number }
export interface Competition { id: string; categoryId: string; name: string; kind: ScoreKind; direction: Direction; unit: string; team: boolean; teamSize: number; instructions: string; active: boolean }
export interface Participant { id: string; name: string; normalizedName: string }
export interface Team { id: string; eventId: string; name: string; memberIds: string[] }
/**
 * The signed-in person within one conference. `admin` means conference admin of
 * THIS conference (custom claim admin, a platformRoles document, or a
 * conferences/{cid}/admins document for the verified Google email); `organizer`
 * means platform organizer (custom claim or platformRoles document).
 */
export interface Identity { uid: string; name: string; participantId?: string; admin: boolean; organizer?: boolean; email?: string }
export interface Attempt { id: string; eventId: string; participantId: string; value: number; valid: boolean; recordedBy: string; recorderName: string; createdAt: number; updatedAt: number; revision: number }
export interface Match { id: string; round: number; position: number; sideA: string | null; sideB: string | null; winnerId: string | null; bye: boolean }
export interface Bracket { id: string; eventId: string; entrants: string[]; matches: Match[]; status: 'registration' | 'active' | 'complete'; revision: number; entrantsOpen?: boolean }
export interface KnockoutGame { id: string; eventId: string; entrants: string[]; status: 'registration' | 'active' | 'complete'; winnerId: string | null; revision: number }
export interface AuditEntry { id: string; action: string; entityType: string; entityId: string; actorUid: string; actorName: string; at: number; before: unknown; after: unknown; reason: string }
export interface ConferenceState { categories: Category[]; events: Competition[]; participants: Participant[]; teams: Team[]; attempts: Attempt[]; brackets: Bracket[]; games: KnockoutGame[]; audit: AuditEntry[] }
export interface Standing { id: string; name: string; rank: number; points: number; value: number; eventsPlayed: number }
export type ConferenceStatus = 'draft' | 'live' | 'archived';
/** conferences/{id}. `slug` always equals `id`; dates are ISO calendar dates (YYYY-MM-DD). */
export interface Conference { id: string; name: string; slug: string; startDate: string; endDate: string; location: string; status: ConferenceStatus; createdAt?: number }
/** settings/platform */
export interface PlatformSettings { defaultConferenceId: string }
/**
 * `conference` is null until loaded and when missing. `conferenceState` tells
 * those apart: 'missing' covers both a nonexistent conference and a draft the
 * viewer may not see.
 */
export interface AppSnapshot { conferenceId: string; conference: Conference | null; conferenceState: 'loading' | 'ready' | 'missing'; data: ConferenceState; identity: Identity | null; loading: boolean; identityLoading: boolean; error: string | null; mode: 'demo' | 'firebase'; connected: boolean }
export type Command =
 | { type: 'identity'; name: string; participantId?: string }
 | { type: 'attempt'; eventId: string; name: string; participantId?: string; value: number; requestId: string }
 | { type: 'correctAttempt'; id: string; value: number; valid: boolean; reason: string; revision: number }
 | { type: 'saveEvent'; event: Competition; reason: string }
 | { type: 'saveCategory'; category: Category; reason: string }
 | { type: 'renameParticipant'; id: string; name: string; reason: string }
 | { type: 'addParticipant'; name: string }
 | { type: 'saveTeam'; eventId: string; name: string; memberIds: string[]; teamId?: string }
 | { type: 'joinBracket'; eventId: string; entrantId: string }
 | { type: 'startBracket'; eventId: string; entrantIds: string[] }
 | { type: 'addBracketTeam'; bracketId: string; teamId: string; revision: number }
 | { type: 'addBracketParticipant'; bracketId: string; participantId: string; revision: number }
 | { type: 'matchWinner'; bracketId: string; matchId: string; winnerId: string; revision: number; reason?: string }
 | { type: 'joinGame'; eventId: string; participantId: string }
 | { type: 'startGame'; eventId: string }
 | { type: 'gameWinner'; eventId: string; winnerId: string; revision: number; reason?: string };
export interface ConferenceStore { getSnapshot(): AppSnapshot; subscribe(listener: () => void): () => void; execute(command: Command): Promise<void>; signInWithGoogle(preferredName?: string): Promise<void>; signInAdmin(): Promise<void>; signOutAdmin(): Promise<void>; clearError(): void; dispose(): void }
