import { describe, expect, it } from "vitest";
import type { Category, Competition } from "./types";
import { categoriesWithActiveEvents } from "./catalog";

const categories: Category[] = [
  { id: "physical", name: "Physical", group: "physical", order: 1 },
  { id: "athleticism", name: "Athleticism", group: "physical", order: 2 },
];

const event = (categoryId: string, active: boolean): Competition => ({
  id: `${categoryId}-${active}`,
  categoryId,
  name: "Test event",
  kind: "count",
  direction: "higher",
  unit: "reps",
  team: false,
  teamSize: 1,
  instructions: "",
  active,
});

describe("categoriesWithActiveEvents", () => {
  it("omits categories with no active events while preserving category order", () => {
    expect(categoriesWithActiveEvents(categories, [event("physical", true), event("athleticism", false)])).toEqual([
      categories[0],
    ]);
  });
});
