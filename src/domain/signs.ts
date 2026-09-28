import type { Competition } from "./types";

/**
 * Builds the URL a printed event sign's QR code should open. All URL
 * construction for signs lives here so the routing rewrite that adds
 * `/c/:slug/...` paths only has to change this one function.
 */
export function eventSignUrl(
  origin: string,
  conferenceSlug: string | null | undefined,
  eventId: string,
): string {
  const base = origin.replace(/\/$/, "");
  return conferenceSlug
    ? `${base}/c/${conferenceSlug}/events/${eventId}`
    : `${base}/events/${eventId}`;
}

/** Same idea as {@link eventSignUrl}, for the conference poster's events list. */
export function conferenceSignUrl(
  origin: string,
  conferenceSlug: string | null | undefined,
): string {
  const base = origin.replace(/\/$/, "");
  return conferenceSlug ? `${base}/c/${conferenceSlug}/events` : `${base}/events`;
}

/**
 * A short scoring-summary line for a sign, derived from the event's kind,
 * direction and unit — e.g. "Most reps wins", "Fastest time wins",
 * "Bracket — single elimination".
 */
export function scoringSummary(event: Competition): string {
  if (event.kind === "bracket")
    return `${event.team ? "Team bracket" : "Bracket"} — single elimination`;
  if (event.kind === "knockout") return "Knockout — last player standing";
  const base =
    event.kind === "duration"
      ? event.direction === "higher"
        ? "Longest time"
        : "Fastest time"
      : event.kind === "distance"
        ? event.direction === "higher"
          ? "Farthest distance"
          : "Shortest distance"
        : event.direction === "higher"
          ? `Most ${event.unit.trim() || "reps"}`
          : `Fewest ${event.unit.trim() || "reps"}`;
  return event.team ? `Team ${base.toLowerCase()} wins` : `${base} wins`;
}
