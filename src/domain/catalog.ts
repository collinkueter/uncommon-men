import type { Category, Competition } from "./types";

export const initialCategories: Category[] = [
  { id: "brute-strength", name: "Brute Strength", group: "physical", order: 1 },
  { id: "endurance", name: "Endurance / Stamina", group: "physical", order: 2 },
  { id: "precision-accuracy", name: "Precision & Accuracy", group: "physical", order: 3 },
  { id: "brain-strength", name: "Brain Strength / Mental Fortitude", group: "mental", order: 4 },
  { id: "strategy-tactics", name: "Strategy & Tactics", group: "mental", order: 5 },
  { id: "hand-eye-coordination", name: "Hand-Eye Coordination / Reflexes", group: "mental", order: 6 },
];

const event = (
  id: string,
  categoryId: string,
  name: string,
  kind: Competition["kind"],
  direction: Competition["direction"],
  unit: string,
  team = false,
  teamSize = 0,
  instructions = "",
): Competition => ({
  id,
  categoryId,
  name,
  kind,
  direction,
  unit,
  team,
  teamSize,
  instructions,
  active: true,
});

export const initialEvents: Competition[] = [
  event("dumbbell-hold-10-lb", "brute-strength", "Dumbbell Hold - 10 lb", "duration", "higher", "seconds"),
  event("dumbbell-hold-20-lb", "brute-strength", "Dumbbell Hold - 20 lb", "duration", "higher", "seconds"),
  event("push-up", "brute-strength", "Push Up", "count", "higher", "reps"),
  event("plank-holds", "endurance", "Plank Holds", "duration", "higher", "seconds"),
  event("cornhole", "precision-accuracy", "Cornhole", "bracket", "higher", "match", true, 2),
  event("basketball-free-throws", "precision-accuracy", "Basketball Free Throws", "count", "higher", "consecutive free throws"),
  event("lightning-knockout", "precision-accuracy", "Lightning / Knockout", "bracket", "higher", "match", false, 0, "Play from the free-throw or three-point line."),
  event("pound-the-nail", "precision-accuracy", "Pound the Nail the Fastest", "duration", "lower", "seconds"),
  event("grid-based-logic-puzzle", "brain-strength", "Grid Based Logic Puzzle", "duration", "lower", "seconds", false, 0, "Timed."),
  event("sudoku", "brain-strength", "Sudoku", "duration", "lower", "seconds", false, 0, "Timed."),
  event("chess", "strategy-tactics", "Chess", "bracket", "higher", "match"),
  event("checkers", "strategy-tactics", "Checkers", "bracket", "higher", "match"),
  event("table-tennis", "hand-eye-coordination", "Table Tennis", "bracket", "higher", "match"),
  event("carpet-ball", "hand-eye-coordination", "Carpet Ball", "bracket", "higher", "match"),
  event("foosball", "hand-eye-coordination", "Foosball", "bracket", "higher", "match", true, 2),
];
