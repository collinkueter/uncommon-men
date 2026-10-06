// Audited Firestore writes for organizer and conference-admin actions. They
// take the Firestore instance explicitly so the rules tests exercise exactly
// what the app commits.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import {
  cleanDetails,
  copyCatalog,
  detailsError,
  emailError,
  LAST_ORGANIZER_ERROR,
  normalizeEmail,
  removesLastOrganizer,
  resolveServerTime,
  type CatalogCopy,
  type ConferenceChanges,
  type ConferenceCreationPlan,
} from "@/domain/conferences";
import type { Category, Competition } from "@/domain/types";

export interface PlatformActor {
  uid: string;
  /** The Google email exactly as in the ID token; conference, role and settings audits must match it. */
  email: string;
}

export const newAuditId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function requireEmail(actor: PlatformActor) {
  if (!actor.email) throw new Error("Sign in with a verified Google account first.");
}

/**
 * Commits a creation plan chunk by chunk (each chunk is one batch holding whole
 * document + audit pairs), then publishes the conference if it was requested live.
 */
export async function commitConferenceCreation(
  db: Firestore,
  actor: PlatformActor,
  plan: ConferenceCreationPlan,
  onProgress?: (done: number, total: number) => void,
) {
  requireEmail(actor);
  const existing = await getDoc(doc(db, "conferences", plan.conferenceId)).catch(() => null);
  if (existing?.exists()) throw new Error("Another conference already uses this web address.");
  const stamp = serverTimestamp();
  const total = plan.chunks.length + (plan.publish ? 1 : 0);
  for (const [index, chunk] of plan.chunks.entries()) {
    const batch = writeBatch(db);
    for (const { target, audit } of chunk) {
      batch.set(doc(db, target.path.join("/")), resolveServerTime(target.data, stamp));
      batch.set(doc(db, audit.path.join("/")), resolveServerTime(audit.data, stamp));
    }
    await batch.commit();
    onProgress?.(index + 1, total);
  }
  if (plan.publish) {
    await updateConference(db, actor, plan.conferenceId, { status: "live" }, "publishConference", "Published at creation");
    onProgress?.(total, total);
  }
}

/**
 * An audited change to conferences/{cid}. Conference admins may change the
 * descriptive fields of a conference that is not archived; status is organizer-only.
 */
export async function updateConference(
  db: Firestore,
  actor: PlatformActor,
  cid: string,
  changes: ConferenceChanges,
  action = "saveConference",
  reason = "Conference details updated",
) {
  requireEmail(actor);
  const ref = doc(db, "conferences", cid);
  const auditId = newAuditId();
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("Conference not found.");
    const before = snapshot.data();
    const details = {
      name: String(changes.name ?? before.name),
      startDate: String(changes.startDate ?? before.startDate),
      endDate: String(changes.endDate ?? before.endDate),
      location: String(changes.location ?? before.location ?? ""),
    };
    const error = detailsError(details);
    if (error) throw new Error(error);
    const after = { ...before, ...cleanDetails(details), ...(changes.status && { status: changes.status }), auditId };
    transaction.set(ref, after);
    transaction.set(doc(db, "conferences", cid, "audit", auditId), {
      action,
      entityType: "conference",
      entityId: cid,
      actorUid: actor.uid,
      actorName: actor.email,
      at: serverTimestamp(),
      before,
      after,
      reason,
    });
  });
}

/** settings/platform.defaultConferenceId: where legacy links and printed QR codes land. */
export async function setDefaultConference(db: Firestore, actor: PlatformActor, cid: string) {
  requireEmail(actor);
  const ref = doc(db, "settings", "platform");
  const auditId = newAuditId();
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const before = snapshot.exists() ? snapshot.data() : null;
    const after = { defaultConferenceId: cid, auditId };
    transaction.set(ref, after);
    transaction.set(doc(db, "platformAudit", auditId), {
      action: "setDefaultConference",
      entityType: "settings",
      entityId: "platform",
      actorUid: actor.uid,
      actorName: actor.email,
      at: serverTimestamp(),
      before,
      after,
      reason: "Default conference changed",
    });
  });
}

// A grant creates the role document with a fresh audit entry; a revoke deletes
// it with an audit entry whose id is "<grant auditId>-revoke", as the rules require.
async function setRole(
  db: Firestore,
  actor: PlatformActor,
  ref: DocumentReference,
  auditCollection: string[],
  entityType: "platformRoles" | "admins",
  value: Record<string, unknown>,
  grant: boolean,
) {
  requireEmail(actor);
  const action = entityType === "platformRoles"
    ? grant ? "grantOrganizer" : "revokeOrganizer"
    : grant ? "grantAdmin" : "revokeAdmin";
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);
    if (grant === existing.exists()) return false;
    const before = existing.exists() ? existing.data() : null;
    const auditId = grant ? newAuditId() : `${String(before?.auditId)}-revoke`;
    const after = grant ? { ...value, auditId } : null;
    if (after) transaction.set(ref, after);
    else transaction.delete(ref);
    transaction.set(doc(db, [...auditCollection, auditId].join("/")), {
      action,
      entityType,
      entityId: ref.id,
      actorUid: actor.uid,
      actorName: actor.email,
      at: serverTimestamp(),
      before,
      after,
      reason: grant ? "Role granted in the app" : "Role revoked in the app",
    });
    return true;
  });
}

function checkedEmail(value: string) {
  const error = emailError(value);
  if (error) throw new Error(error);
  return normalizeEmail(value);
}

export async function setOrganizerRole(db: Firestore, actor: PlatformActor, email: string, grant: boolean) {
  const key = checkedEmail(email);
  // The rules cannot count documents, so the app refuses to remove the last
  // listed organizer; otherwise nobody could reach /organizer again.
  if (!grant) {
    const organizers = await getDocs(collection(db, "platformRoles"));
    if (removesLastOrganizer(organizers.docs.map((item) => item.id), key)) throw new Error(LAST_ORGANIZER_ERROR);
  }
  return setRole(db, actor, doc(db, "platformRoles", key), ["platformAudit"], "platformRoles", { role: "organizer" }, grant);
}

export function setConferenceAdminRole(db: Firestore, actor: PlatformActor, cid: string, email: string, grant: boolean) {
  const key = checkedEmail(email);
  return setRole(
    db,
    actor,
    doc(db, "conferences", cid, "admins", key),
    ["conferences", cid, "audit"],
    "admins",
    { email: key },
    grant,
  );
}

/** A conference's categories and events (never its participants or results), for copying. */
export async function readCatalog(db: Firestore, cid: string): Promise<CatalogCopy> {
  const [categories, events] = await Promise.all([
    getDocs(collection(db, "conferences", cid, "categories")),
    getDocs(collection(db, "conferences", cid, "events")),
  ]);
  return copyCatalog({
    categories: categories.docs
      .map((item) => ({ ...item.data(), id: item.id }) as Category)
      .sort((left, right) => left.order - right.order),
    events: events.docs.map((item) => ({ ...item.data(), id: item.id }) as Competition),
  });
}
