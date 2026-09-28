import { doc, setDoc, Timestamp } from "firebase/firestore";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";

export const CONFERENCE_ID = "uncommon-men-2026";
/** Path prefix for every conference-scoped document in the rules tests. */
export const C = `conferences/${CONFERENCE_ID}`;

export function conferenceDoc(slug = CONFERENCE_ID, status: "draft" | "live" | "archived" = "live") {
  return {
    name: slug === CONFERENCE_ID ? "Uncommon Men 2026" : `Conference ${slug}`,
    slug,
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    location: "Test venue",
    status,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    auditId: `seed-conference-${slug}`,
  };
}

export async function seedConference(
  environment: RulesTestEnvironment,
  slug = CONFERENCE_ID,
  status: "draft" | "live" | "archived" = "live",
) {
  await environment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), "conferences", slug), conferenceDoc(slug, status)),
  );
}
