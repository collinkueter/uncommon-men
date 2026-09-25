import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "uncommon-men-rules-test",
    firestore: {
      host: "127.0.0.1",
      port: 8180,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});
afterEach(async () => environment.clearFirestore());
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "events", "pull-up"), {
        categoryId: "strength",
        name: "Pull Up",
        kind: "count",
        direction: "higher",
        unit: "reps",
        team: false,
        teamSize: 0,
        instructions: "",
        active: true,
        auditId: "seed-event",
      }),
      setDoc(doc(db, "participants", "p1"), {
        name: "Participant",
        normalizedName: "participant",
        auditId: "seed-person",
      }),
      setDoc(doc(db, "identities", "recorder-1"), {
        uid: "recorder-1",
        name: "Recorder",
        participantId: null,
        auditId: "seed-identity",
      }),
      setDoc(doc(db, "identities", "admin-1"), {
        uid: "admin-1",
        name: "Admin",
        participantId: null,
        auditId: "seed-admin",
      }),
    ]);
  });
});

function participantBatch(uid: string, actorUid = uid, auditId = "audit-1") {
  const db = environment.authenticatedContext(uid).firestore();
  const target = doc(db, "participants", "name-marcus");
  const audit = doc(db, "audit", auditId);
  const after = { name: "Marcus Reed", normalizedName: "marcus reed", auditId };
  const batch = writeBatch(db);
  batch.set(target, after);
  batch.set(audit, {
    action: "addParticipant",
    entityType: "participants",
    entityId: target.id,
    actorUid,
    actorName: "Recorder",
    at: serverTimestamp(),
    before: null,
    after,
    reason: "First result",
  });
  return batch;
}

describe("Firestore conference rules", () => {
  const bracket: any = {
    eventId: "chess",
    entrants: ["p1", "p2", "p3", "p4"],
    status: "active",
    revision: 1,
    auditId: "seed-bracket",
    matches: [
      {
        id: "m0",
        round: 1,
        position: 0,
        sideA: "p1",
        sideB: "p2",
        winnerId: null,
        bye: false,
      },
      {
        id: "m1",
        round: 1,
        position: 1,
        sideA: "p3",
        sideB: "p4",
        winnerId: null,
        bye: false,
      },
      {
        id: "m2",
        round: 2,
        position: 0,
        sideA: null,
        sideB: null,
        winnerId: null,
        bye: false,
      },
    ],
  };
  async function seedBracket(value = bracket) {
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), "brackets", "chess-bracket"), value),
    );
  }
  function bracketUpdate(after: Record<string, unknown>, auditId: string) {
    const db = environment.authenticatedContext("recorder-1").firestore();
    const target = doc(db, "brackets", "chess-bracket");
    const audit = doc(db, "audit", auditId);
    const withAudit = { ...after, auditId };
    return writeBatch(db).set(target, withAudit).set(audit, {
      action: "matchWinner",
      entityType: "brackets",
      entityId: target.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at: serverTimestamp(),
      before: bracket,
      after: withAudit,
      reason: "Winner selected",
    });
  }
  it("allows an authenticated, atomically audited participant create", async () => {
    await assertSucceeds(participantBatch("recorder-1").commit());
  });

  it("rejects unauthenticated and unaudited writes", async () => {
    const publicDb = environment.unauthenticatedContext().firestore();
    await assertFails(
      writeBatch(publicDb)
        .set(doc(publicDb, "participants", "p1"), {
          name: "A",
          normalizedName: "a",
          auditId: "x",
        })
        .commit(),
    );
    const db = environment.authenticatedContext("recorder-1").firestore();
    await assertFails(
      writeBatch(db)
        .set(doc(db, "participants", "p2"), {
          name: "B",
          normalizedName: "b",
          auditId: "missing",
        })
        .commit(),
    );
  });

  it("rejects a forged audit actor and reuse of an existing audit id", async () => {
    await assertFails(participantBatch("recorder-1", "someone-else").commit());
    await assertSucceeds(participantBatch("recorder-1").commit());
    const db = environment.authenticatedContext("recorder-1").firestore();
    const target = doc(db, "participants", "name-second");
    const after = {
      name: "Second Person",
      normalizedName: "second person",
      auditId: "audit-1",
    };
    await assertFails(writeBatch(db).set(target, after).commit());
  });

  it("allows a new result once and blocks an overwrite by its recorder", async () => {
    const db = environment.authenticatedContext("recorder-1").firestore();
    const target = doc(db, "attempts", "request-1");
    const audit = doc(db, "audit", "attempt-audit");
    const time = serverTimestamp();
    const after = {
      eventId: "pull-up",
      participantId: "p1",
      value: 21,
      valid: true,
      recordedBy: "recorder-1",
      recorderName: "Recorder",
      createdAt: time,
      updatedAt: time,
      revision: 1,
      requestId: "request-1",
      auditId: audit.id,
    };
    const batch = writeBatch(db);
    batch.set(target, after);
    batch.set(audit, {
      action: "attempt",
      entityType: "attempts",
      entityId: target.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at: time,
      before: null,
      after,
      reason: "Result submitted",
    });
    await assertSucceeds(batch.commit());
    await assertFails(writeBatch(db).update(target, { value: 999 }).commit());
  });

  it("rejects unknown references, decimal counts, and forged recorder names", async () => {
    const db = environment.authenticatedContext("recorder-1").firestore();
    const make = (id: string, overrides: Record<string, unknown>) => {
      const target = doc(db, "attempts", id);
      const audit = doc(db, "audit", `audit-${id}`);
      const time = serverTimestamp();
      const after = {
        eventId: "pull-up",
        participantId: "p1",
        value: 2,
        valid: true,
        recordedBy: "recorder-1",
        recorderName: "Recorder",
        createdAt: time,
        updatedAt: time,
        revision: 1,
        requestId: id,
        auditId: audit.id,
        ...overrides,
      };
      return writeBatch(db).set(target, after).set(audit, {
        action: "attempt",
        entityType: "attempts",
        entityId: id,
        actorUid: "recorder-1",
        actorName: "Recorder",
        at: time,
        before: null,
        after,
        reason: "Result submitted",
      });
    };
    await assertFails(
      make("unknown-person", { participantId: "missing" }).commit(),
    );
    await assertFails(make("decimal-count", { value: 2.5 }).commit());
    await assertFails(
      make("forged-name", { recorderName: "Administrator" }).commit(),
    );
  });

  it("lets a first-time visitor save a name and join the roster in one write", async () => {
    const db = environment.authenticatedContext("new-visitor").firestore();
    const identityRef = doc(db, "identities", "new-visitor");
    const participantRef = doc(db, "participants", "name-collin");
    const participantAuditRef = doc(db, "audit", "join-participant-audit");
    const identityAuditRef = doc(db, "audit", "join-identity-audit");
    const at = serverTimestamp();
    const participantAfter = { name: "Collin", normalizedName: "collin", auditId: participantAuditRef.id };
    const identityAfter = { uid: "new-visitor", name: "Collin", participantId: participantRef.id, auditId: identityAuditRef.id };
    const batch = writeBatch(db);
    batch.set(participantRef, participantAfter);
    batch.set(participantAuditRef, {
      action: "addParticipant", entityType: "participants", entityId: participantRef.id,
      actorUid: "new-visitor", actorName: "Collin", at, before: null, after: participantAfter,
      reason: "Joined the roster by entering a name",
    });
    batch.set(identityRef, identityAfter);
    batch.set(identityAuditRef, {
      action: "identity", entityType: "identities", entityId: "new-visitor",
      actorUid: "new-visitor", actorName: "Collin", at, before: null, after: identityAfter,
      reason: "Identity updated",
    });
    await assertSucceeds(batch.commit());
  });

  it("allows first result to create participant and link the recorder identity atomically", async () => {
    const db = environment.authenticatedContext("recorder-1").firestore();
    const identityRef = doc(db, "identities", "recorder-1");
    const identityBefore = (await getDoc(identityRef)).data()!;
    const participantRef = doc(db, "participants", "name-new-recorder");
    const attemptRef = doc(db, "attempts", "first-result-request");
    const participantAuditRef = doc(db, "audit", "first-participant-audit");
    const attemptAuditRef = doc(db, "audit", "first-attempt-audit");
    const identityAuditRef = doc(db, "audit", "first-identity-audit");
    const at = serverTimestamp();
    const participantAfter = {
      name: "Recorder",
      normalizedName: "recorder",
      auditId: participantAuditRef.id,
    };
    const attemptAfter = {
      eventId: "pull-up",
      participantId: participantRef.id,
      value: 12,
      valid: true,
      recordedBy: "recorder-1",
      recorderName: "Recorder",
      createdAt: at,
      updatedAt: at,
      revision: 1,
      requestId: attemptRef.id,
      auditId: attemptAuditRef.id,
    };
    const identityAfter = {
      uid: "recorder-1",
      name: "Recorder",
      participantId: participantRef.id,
      auditId: identityAuditRef.id,
    };
    const batch = writeBatch(db);
    batch.set(participantRef, participantAfter);
    batch.set(participantAuditRef, {
      action: "addParticipant",
      entityType: "participants",
      entityId: participantRef.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at,
      before: null,
      after: participantAfter,
      reason: "Created with first result",
    });
    batch.set(attemptRef, attemptAfter);
    batch.set(attemptAuditRef, {
      action: "attempt",
      entityType: "attempts",
      entityId: attemptRef.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at,
      before: null,
      after: attemptAfter,
      reason: "Result submitted",
    });
    batch.set(identityRef, identityAfter);
    batch.set(identityAuditRef, {
      action: "identity",
      entityType: "identities",
      entityId: identityRef.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at,
      before: identityBefore,
      after: identityAfter,
      reason: "Linked first result",
    });
    await assertSucceeds(batch.commit());
  });

  it("requires an admin and exact before/after audit for a correction", async () => {
    const recorderDb = environment
      .authenticatedContext("recorder-1")
      .firestore();
    const target = doc(recorderDb, "attempts", "request-1");
    const createAudit = doc(recorderDb, "audit", "attempt-create");
    const createTime = serverTimestamp();
    const initial = {
      eventId: "pull-up",
      participantId: "p1",
      value: 21,
      valid: true,
      recordedBy: "recorder-1",
      recorderName: "Recorder",
      createdAt: createTime,
      updatedAt: createTime,
      revision: 1,
      requestId: "request-1",
      auditId: createAudit.id,
    };
    const create = writeBatch(recorderDb);
    create.set(target, initial).set(createAudit, {
      action: "attempt",
      entityType: "attempts",
      entityId: target.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at: createTime,
      before: null,
      after: initial,
      reason: "Result submitted",
    });
    await assertSucceeds(create.commit());
    const before = (await getDoc(target)).data()!;
    const nonAdminAudit = doc(recorderDb, "audit", "bad-correction");
    const updateTime = serverTimestamp();
    const nonAdminAfter = {
      ...before,
      value: 22,
      revision: 2,
      updatedAt: updateTime,
      auditId: nonAdminAudit.id,
    };
    const denied = writeBatch(recorderDb)
      .set(target, nonAdminAfter)
      .set(nonAdminAudit, {
        action: "correctAttempt",
        entityType: "attempts",
        entityId: target.id,
        actorUid: "recorder-1",
        actorName: "Recorder",
        at: updateTime,
        before,
        after: nonAdminAfter,
        reason: "Correction",
      });
    await assertFails(denied.commit());

    const adminDb = environment
      .authenticatedContext("admin-1", { admin: true })
      .firestore();
    const adminTarget = doc(adminDb, "attempts", target.id);
    const adminAudit = doc(adminDb, "audit", "good-correction");
    const adminTime = serverTimestamp();
    const after = {
      ...before,
      value: 22,
      revision: 2,
      updatedAt: adminTime,
      auditId: adminAudit.id,
    };
    const allowed = writeBatch(adminDb)
      .set(adminTarget, after)
      .set(adminAudit, {
        action: "correctAttempt",
        entityType: "attempts",
        entityId: target.id,
        actorUid: "admin-1",
        actorName: "Admin",
        at: adminTime,
        before,
        after,
        reason: "Timing review",
      });
    await assertSucceeds(allowed.commit());
  });

  it("allows only admins to edit an existing team roster with an audit", async () => {
    const before = { eventId: "cornhole", name: "Team One", memberIds: ["p1", "p2"], auditId: "seed-team" };
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, "events", "cornhole"), { team: true, teamSize: 2 }),
        setDoc(doc(db, "participants", "p2"), { name: "Second" }),
        setDoc(doc(db, "participants", "p3"), { name: "Third" }),
        setDoc(doc(db, "teams", "team-one"), before),
      ]);
    });
    for (const isAdmin of [false, true]) {
      const uid = isAdmin ? "admin-1" : "recorder-1";
      const db = environment.authenticatedContext(uid, { admin: isAdmin }).firestore();
      const auditId = `team-edit-${uid}`;
      const after = { ...before, name: "Renamed Team", memberIds: ["p1", "p3"], auditId };
      const update = writeBatch(db)
        .set(doc(db, "teams", "team-one"), after)
        .set(doc(db, "audit", auditId), {
          action: "saveTeam", entityType: "teams", entityId: "team-one",
          actorUid: uid, actorName: isAdmin ? "Admin" : "Recorder",
          at: serverTimestamp(), before, after, reason: "Roster correction",
        }).commit();
      if (isAdmin) await assertSucceeds(update);
      else await assertFails(update);
    }
  });

  it("allows audit reads only for admins", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "audit", "seed-read-audit"), {
        action: "attempt",
        entityType: "attempts",
        entityId: "request-1",
        actorUid: "recorder-1",
        actorName: "Recorder",
        at: new Date(),
        before: null,
        after: {},
        reason: "Seeded audit",
      });
    });
    const publicDb = environment.unauthenticatedContext().firestore();
    const recorderDb = environment.authenticatedContext("recorder-1").firestore();
    const adminDb = environment.authenticatedContext("admin-1", { admin: true }).firestore();
    const auditRef = doc(adminDb, "audit", "seed-read-audit");

    await assertFails(getDoc(doc(publicDb, "audit", auditRef.id)));
    await assertFails(getDoc(doc(recorderDb, "audit", auditRef.id)));
    await assertSucceeds(getDoc(auditRef));
  });

  it("rejects an attempted self-grant of the admin field", async () => {
    const db = environment.authenticatedContext("recorder-1").firestore();
    const identityRef = doc(db, "identities", "recorder-1");
    const auditRef = doc(db, "audit", "self-grant-audit");
    const before = (await getDoc(identityRef)).data()!;
    const after = {
      ...before,
      admin: true,
      auditId: auditRef.id,
    };
    await assertFails(
      writeBatch(db)
        .set(identityRef, after)
        .set(auditRef, {
          action: "identity",
          entityType: "identities",
          entityId: identityRef.id,
          actorUid: "recorder-1",
          actorName: "Recorder",
          at: serverTimestamp(),
          before,
          after,
          reason: "Attempted self-grant",
        })
        .commit(),
    );
  });

  it("requires an admin and exact audit for valid category and event creates", async () => {
    const categoryAfter = {
      name: "Strength",
      group: "physical",
      order: 10,
    };
    const recorderDb = environment.authenticatedContext("recorder-1").firestore();
    const deniedCategory = doc(recorderDb, "categories", "strength");
    const deniedCategoryAudit = doc(recorderDb, "audit", "denied-category-create");
    await assertFails(
      writeBatch(recorderDb)
        .set(deniedCategory, { ...categoryAfter, auditId: deniedCategoryAudit.id })
        .set(deniedCategoryAudit, {
          action: "saveCategory",
          entityType: "categories",
          entityId: deniedCategory.id,
          actorUid: "recorder-1",
          actorName: "Recorder",
          at: serverTimestamp(),
          before: null,
          after: { ...categoryAfter, auditId: deniedCategoryAudit.id },
          reason: "Unauthorized setup",
        })
        .commit(),
    );

    const eventAfter = {
      categoryId: "strength",
      name: "Burpees",
      kind: "count",
      direction: "higher",
      unit: "reps",
      team: false,
      teamSize: 0,
      instructions: "Complete as many repetitions as possible.",
      active: true,
    };
    const deniedEvent = doc(recorderDb, "events", "burpees");
    const deniedEventAudit = doc(recorderDb, "audit", "denied-event-create");
    await assertFails(
      writeBatch(recorderDb)
        .set(deniedEvent, { ...eventAfter, auditId: deniedEventAudit.id })
        .set(deniedEventAudit, {
          action: "saveEvent",
          entityType: "events",
          entityId: deniedEvent.id,
          actorUid: "recorder-1",
          actorName: "Recorder",
          at: serverTimestamp(),
          before: null,
          after: { ...eventAfter, auditId: deniedEventAudit.id },
          reason: "Unauthorized setup",
        })
        .commit(),
    );

    const adminDb = environment.authenticatedContext("admin-1", { admin: true }).firestore();
    const categoryRef = doc(adminDb, "categories", "admin-strength");
    const categoryAuditRef = doc(adminDb, "audit", "admin-category-create");
    const validCategory = { ...categoryAfter, auditId: categoryAuditRef.id };
    await assertSucceeds(
      writeBatch(adminDb)
        .set(categoryRef, validCategory)
        .set(categoryAuditRef, {
          action: "saveCategory",
          entityType: "categories",
          entityId: categoryRef.id,
          actorUid: "admin-1",
          actorName: "Admin",
          at: serverTimestamp(),
          before: null,
          after: validCategory,
          reason: "Create category",
        })
        .commit(),
    );

    const eventRef = doc(adminDb, "events", "admin-burpees");
    const eventAuditRef = doc(adminDb, "audit", "admin-event-create");
    const validEvent = { ...eventAfter, categoryId: categoryRef.id, auditId: eventAuditRef.id };
    await assertSucceeds(
      writeBatch(adminDb)
        .set(eventRef, validEvent)
        .set(eventAuditRef, {
          action: "saveEvent",
          entityType: "events",
          entityId: eventRef.id,
          actorUid: "admin-1",
          actorName: "Admin",
          at: serverTimestamp(),
          before: null,
          after: validEvent,
          reason: "Create event",
        })
        .commit(),
    );
  });

  it("protects event configuration with the admin custom claim", async () => {
    const db = environment.authenticatedContext("recorder-1").firestore();
    const target = doc(db, "events", "pull-up");
    const audit = doc(db, "audit", "event-audit");
    const after = {
      categoryId: "strength",
      name: "Pull Up",
      kind: "count",
      direction: "higher",
      unit: "reps",
      team: false,
      teamSize: 0,
      instructions: "",
      active: true,
      auditId: audit.id,
    };
    const batch = writeBatch(db).set(target, after).set(audit, {
      action: "saveEvent",
      entityType: "events",
      entityId: target.id,
      actorUid: "recorder-1",
      actorName: "Recorder",
      at: serverTimestamp(),
      before: null,
      after,
      reason: "Unauthorized setup",
    });
    await assertFails(batch.commit());
  });

  it("allows one pending bracket winner and its exact parent advancement", async () => {
    await seedBracket();
    const matches = bracket.matches.map((match: any) => ({ ...match }));
    matches[0].winnerId = "p1";
    matches[2].sideA = "p1";
    await assertSucceeds(
      bracketUpdate(
        {
          ...bracket,
          matches,
          revision: 2,
          lastMatchIndex: 0,
          lastParentIndex: 2,
        },
        "bracket-ok",
      ).commit(),
    );
  });

  it("rejects wrong winners, unrelated match edits, and wrong parent advancement", async () => {
    await seedBracket();
    const wrongWinner = bracket.matches.map((match: any) => ({ ...match }));
    wrongWinner[0].winnerId = "p4";
    wrongWinner[2].sideA = "p4";
    await assertFails(
      bracketUpdate(
        {
          ...bracket,
          matches: wrongWinner,
          revision: 2,
          lastMatchIndex: 0,
          lastParentIndex: 2,
        },
        "bracket-wrong-winner",
      ).commit(),
    );
    const unrelated = bracket.matches.map((match: any) => ({ ...match }));
    unrelated[0].winnerId = "p1";
    unrelated[1].sideA = "tampered";
    unrelated[2].sideA = "p1";
    await assertFails(
      bracketUpdate(
        {
          ...bracket,
          matches: unrelated,
          revision: 2,
          lastMatchIndex: 0,
          lastParentIndex: 2,
        },
        "bracket-unrelated",
      ).commit(),
    );
    const wrongParent = bracket.matches.map((match: any) => ({ ...match }));
    wrongParent[0].winnerId = "p1";
    wrongParent[2].sideB = "p1";
    await assertFails(
      bracketUpdate(
        {
          ...bracket,
          matches: wrongParent,
          revision: 2,
          lastMatchIndex: 0,
          lastParentIndex: 2,
        },
        "bracket-wrong-parent",
      ).commit(),
    );
  });

  it("rejects nonadmin correction of a completed bracket match", async () => {
    const completed = {
      ...bracket,
      matches: bracket.matches.map((match: any, index: number) =>
        index === 0 ? { ...match, winnerId: "p1" } : { ...match },
      ),
    };
    await seedBracket(completed);
    const changed = completed.matches.map((match: any, index: number) =>
      index === 0 ? { ...match, winnerId: "p2" } : { ...match },
    );
    const db = environment.authenticatedContext("recorder-1").firestore();
    const target = doc(db, "brackets", "chess-bracket");
    const audit = doc(db, "audit", "bracket-overwrite");
    const after = {
      ...completed,
      matches: changed,
      revision: 2,
      lastMatchIndex: 0,
      lastParentIndex: 2,
      auditId: audit.id,
    };
    await assertFails(
      writeBatch(db)
        .set(target, after)
        .set(audit, {
          action: "matchWinner",
          entityType: "brackets",
          entityId: target.id,
          actorUid: "recorder-1",
          actorName: "Recorder",
          at: serverTimestamp(),
          before: completed,
          after,
          reason: "Overwrite",
        })
        .commit(),
    );
  });
});
