// URL helpers for conference-scoped routes: /c/:slug/{welcome,events,...}.
// Pure functions so routing rules are unit-testable without a browser.

/** Used when settings/platform is missing or unreadable, and in demo mode. */
export const DEFAULT_CONFERENCE_ID = "uncommon-men-2026";

/** `/c/<slug>` followed by a conference-relative path such as `/events/push-up?x=1`. */
export function conferencePath(slug: string, path = "/") {
  const relative = path.startsWith("/") ? path : `/${path}`;
  const root = `/c/${encodeURIComponent(slug)}`;
  if (relative === "/") return root;
  if (relative.startsWith("/?")) return `${root}${relative.slice(1)}`;
  return `${root}${relative}`;
}

/** The part of a pathname after `/c/<slug>`; other paths are returned unchanged. */
export function relativeConferencePath(pathname: string) {
  const match = /^\/c\/[^/]+(\/.*)?$/.exec(pathname);
  if (!match) return pathname;
  return match[1] && match[1] !== "/" ? match[1].replace(/\/+$/, "") : "/";
}

/**
 * Printed QR codes and bookmarks point at pre-conference paths such as
 * `/events/<eventId>`. Every non-`/c/` path keeps its path and query under the
 * default conference; unknown paths are resolved by the conference router.
 */
export function legacyRedirectPath(pathname: string, search: string, defaultConferenceId: string) {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return `${conferencePath(defaultConferenceId, trimmed)}${search}`;
}
