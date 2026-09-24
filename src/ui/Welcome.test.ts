import { describe, expect, it } from "vitest";
import type { Identity, Participant } from "@/domain/types";
import { resolveIdentityParticipantId, safeReturnPath } from "./Welcome";

const participant: Participant = {
  id: "participant-1",
  name: "Caleb Johnson",
  normalizedName: "caleb johnson",
};

const identity: Identity = {
  uid: "user-1",
  name: "Caleb Johnson",
  admin: false,
};

describe("identity participant resolution", () => {
  it("preserves the linked participant for an unchanged identity", () => {
    expect(
      resolveIdentityParticipantId(
        "Caleb Johnson",
        { ...identity, participantId: "linked-participant" },
        undefined,
        [participant],
      ),
    ).toBe("linked-participant");
  });

  it("falls through to an exact participant when the identity is not linked", () => {
    expect(
      resolveIdentityParticipantId("caleb johnson", identity, undefined, [participant]),
    ).toBe(participant.id);
  });

  it("resolves a selected exact existing name", () => {
    expect(
      resolveIdentityParticipantId("Caleb Johnson", { ...identity, name: "Other Name" }, undefined, [participant]),
    ).toBe(participant.id);
  });

  it("leaves a new name unlinked", () => {
    expect(
      resolveIdentityParticipantId("New Name", identity, undefined, [participant]),
    ).toBeUndefined();
  });
});

describe("safe return paths", () => {
  it("allows internal event routes", () => {
    expect(safeReturnPath("/events/push-up")).toBe("/events/push-up");
  });

  it.each(["//external.example", "/welcome?next=/events", "/events\\evil", "javascript:alert(1)"]) (
    "falls back for unsafe path %s",
    (path) => {
      expect(safeReturnPath(path)).toBe("/events");
    },
  );
});
