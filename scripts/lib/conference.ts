import { FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_CONFERENCE_ID } from '../../src/lib/conferencePaths';

export { DEFAULT_CONFERENCE_ID };

/** Every conference-scoped collection, all stored under conferences/{cid}/. */
export const CONFERENCE_COLLECTIONS = [
  'categories', 'events', 'participants', 'teams', 'attempts', 'brackets', 'games', 'identities', 'audit',
] as const;

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** The conference a maintenance script operates on: CONFERENCE_ID, defaulting to uncommon-men-2026. */
export function conferenceIdFromEnv(): string {
  const id = process.env.CONFERENCE_ID || DEFAULT_CONFERENCE_ID;
  if (!SLUG.test(id)) throw new Error(`CONFERENCE_ID must be a lowercase slug (letters, digits, hyphens): ${id}`);
  return id;
}

export function conferenceRef(db: Firestore, conferenceId: string): DocumentReference {
  return db.collection('conferences').doc(conferenceId);
}

const today = () => new Date().toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ConferenceFields {
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  status: 'draft' | 'live' | 'archived';
}

/** Conference fields from CONFERENCE_NAME/START_DATE/END_DATE/LOCATION/STATUS, with defaults. */
export function conferenceFieldsFromEnv(conferenceId: string, fallback: Partial<ConferenceFields> = {}): ConferenceFields {
  const status = (process.env.CONFERENCE_STATUS || fallback.status || 'live') as ConferenceFields['status'];
  if (!['draft', 'live', 'archived'].includes(status)) throw new Error(`Invalid CONFERENCE_STATUS: ${status}`);
  const startDate = process.env.CONFERENCE_START_DATE || fallback.startDate || today();
  const endDate = process.env.CONFERENCE_END_DATE || fallback.endDate || startDate;
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || startDate > endDate)
    throw new Error(`Conference dates must be YYYY-MM-DD with start <= end: ${startDate} .. ${endDate}`);
  return {
    name: process.env.CONFERENCE_NAME || fallback.name
      || (conferenceId === DEFAULT_CONFERENCE_ID ? 'Uncommon Men 2026' : conferenceId),
    startDate,
    endDate,
    location: process.env.CONFERENCE_LOCATION ?? fallback.location ?? '',
    status,
  };
}

export interface Actor { uid: string; name: string }

/**
 * Creates conferences/{cid} with an audit entry in conferences/{cid}/audit if it
 * does not exist. An existing conference is never changed. Returns true when created.
 */
export async function ensureConference(db: Firestore, conferenceId: string, fields: ConferenceFields, actor: Actor, reason: string) {
  const ref = conferenceRef(db, conferenceId);
  return db.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return false;
    const auditRef = ref.collection('audit').doc();
    const after = { ...fields, slug: conferenceId, createdAt: FieldValue.serverTimestamp(), auditId: auditRef.id };
    transaction.create(ref, after);
    transaction.create(auditRef, {
      action: 'createConference', entityType: 'conference', entityId: conferenceId,
      actorUid: actor.uid, actorName: actor.name, at: FieldValue.serverTimestamp(),
      before: null, after, reason,
    });
    return true;
  });
}

/**
 * Creates settings/platform { defaultConferenceId } with a platformAudit entry
 * if it does not exist. An existing default is never changed. Returns true when created.
 */
export async function ensurePlatformSettings(db: Firestore, defaultConferenceId: string, actor: Actor, reason: string) {
  const ref = db.collection('settings').doc('platform');
  return db.runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return false;
    const auditRef = db.collection('platformAudit').doc();
    const after = { defaultConferenceId, auditId: auditRef.id };
    transaction.create(ref, after);
    transaction.create(auditRef, {
      action: 'setDefaultConference', entityType: 'settings', entityId: 'platform',
      actorUid: actor.uid, actorName: actor.name, at: FieldValue.serverTimestamp(),
      before: null, after, reason,
    });
    return true;
  });
}
