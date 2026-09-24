export type ScoreKind = 'count' | 'duration' | 'distance' | 'bracket';
export type Direction = 'higher' | 'lower';
export interface Category { id: string; name: string; group: 'physical' | 'mental'; order: number }
export interface Competition { id: string; categoryId: string; name: string; kind: ScoreKind; direction: Direction; unit: string; team: boolean; teamSize: number; instructions: string; active: boolean }
export interface Participant { id: string; name: string; normalizedName: string }
export interface Team { id: string; eventId: string; name: string; memberIds: string[] }
export interface Identity { uid: string; name: string; participantId?: string; admin: boolean }
export interface Attempt { id: string; eventId: string; participantId: string; value: number; valid: boolean; recordedBy: string; recorderName: string; createdAt: number; updatedAt: number; revision: number }
export interface Match { id: string; round: number; position: number; sideA: string | null; sideB: string | null; winnerId: string | null; bye: boolean }
export interface Bracket { id: string; eventId: string; entrants: string[]; matches: Match[]; status: 'active' | 'complete'; revision: number; entrantsOpen?: boolean }
export interface AuditEntry { id: string; action: string; entityType: string; entityId: string; actorUid: string; actorName: string; at: number; before: unknown; after: unknown; reason: string }
export interface ConferenceState { categories: Category[]; events: Competition[]; participants: Participant[]; teams: Team[]; attempts: Attempt[]; brackets: Bracket[]; audit: AuditEntry[] }
export interface Standing { id: string; name: string; rank: number; points: number; value: number; eventsPlayed: number }
export interface AppSnapshot { data: ConferenceState; identity: Identity | null; loading: boolean; error: string | null; mode: 'demo' | 'firebase'; connected: boolean }
export type Command =
 | { type: 'identity'; name: string; participantId?: string }
 | { type: 'attempt'; eventId: string; name: string; participantId?: string; value: number; requestId: string }
 | { type: 'correctAttempt'; id: string; value: number; valid: boolean; reason: string; revision: number }
 | { type: 'saveEvent'; event: Competition; reason: string }
 | { type: 'saveCategory'; category: Category; reason: string }
 | { type: 'renameParticipant'; id: string; name: string; reason: string }
 | { type: 'addParticipant'; name: string }
 | { type: 'saveTeam'; eventId: string; name: string; memberIds: string[]; teamId?: string }
 | { type: 'startBracket'; eventId: string; entrantIds: string[] }
 | { type: 'addBracketTeam'; bracketId: string; teamId: string; revision: number }
 | { type: 'matchWinner'; bracketId: string; matchId: string; winnerId: string; revision: number; reason?: string };
export interface ConferenceStore { getSnapshot(): AppSnapshot; subscribe(listener: () => void): () => void; execute(command: Command): Promise<void>; signInAdmin(): Promise<void>; signOutAdmin(): Promise<void>; clearError(): void; dispose(): void }
