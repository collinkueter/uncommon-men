import { describe, expect, it } from "vitest";
import { createSeedState } from "@/data/seed";
import { participantDetails, safeReturnPath } from "./Welcome";

describe("participant details", () => {
  it("names the team and the last result logged for that team", () => {
    const data = createSeedState();
    const team = data.teams.find((item) => item.memberIds.length)!;
    const member = data.participants.find((item) => item.id === team.memberIds[0])!;
    const event = data.events.find((item) => item.id === team.eventId)!;
    const eventId = data.events.find((item) => item.kind !== "bracket")!.id;
    data.attempts = [
      { id: "a1", eventId, participantId: member.id, value: 10, valid: true, recordedBy: "u", recorderName: "U", createdAt: 1_000, updatedAt: 1_000, revision: 1 },
      { id: "a2", eventId: event.id, participantId: team.id, value: 5, valid: true, recordedBy: "u", recorderName: "U", createdAt: 2_000, updatedAt: 2_000, revision: 1 },
    ];
    const details = participantDetails(member, data, 2_000 + 3 * 3_600_000);
    expect(details.teams).toContain(`${team.name} (`);
    expect(details.teams).toContain(event.name);
    // One team name used in several events is listed once.
    expect(details.teams!.split(team.name)).toHaveLength(2);
    expect(details.activity).toBe(`Last logged ${event.name} 3 hours ago · 2 results`);
  });

  it("describes someone who was only added by name", () => {
    const data = createSeedState();
    expect(participantDetails({ id: "new", name: "Roger", normalizedName: "roger" }, data)).toEqual({
      teams: null,
      activity: "Added to the roster, no results yet",
    });
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
