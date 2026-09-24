# Interface audit and repairs — September 22, 2026

The existing Uncommon Men charcoal, camouflage, lime, and Barlow visual identity is preserved. This was a refinement of the working application, using the frontend-design and impeccable audit/craft guidance.

## Implementation integrity

Pass for the inspected surfaces: controls share a consistent size, fields have explicit spacing and labels, and the custom dropdown is reused across Events, Standings, and all six Admin selectors. The Impeccable mechanical detector returned no findings. That result is separate from the visual and interaction checks below.

## Audit health

These are review judgments for the inspected implementation, not an accessibility certification or measured performance benchmark.

| Dimension | After repairs | Evidence / remaining scope |
| --- | --- | --- |
| Accessibility | 3/4 | Keyboard selection, named fields, visible focus, control states and larger hit areas; full assistive-technology testing remains outside this browser review. |
| Performance | 3/4 | No dropdown dependency added; Admin remains lazy loaded. Existing main bundle warning remains, about 296 KB gzip. |
| Responsive design | 3/4 | Main surfaces inspected at 390px and 1280px, with 768px header check; bracket rounds intentionally scroll horizontally within their board. |
| Theming | 3/4 | Shared tokens drive heights, focus, colors, checkbox accents and dropdown states; some incumbent static surface colors remain in CSS. |
| Implementation integrity | 4/4 | Reusable control and field structure; detector clean; original visual direction retained. |
| Total | **16/20 — Good** | Reported layout defects repaired and verified. |

## Findings and resolutions

| Priority | Finding / impact | Location | Resolution |
| --- | --- | --- | --- |
| P1 | Instructions overlap the scoring pill, obscuring event guidance. | styles.css, ScoreEvent.tsx | Removed the shared negative margin and established an explicit header stack. The measured gap changed from -8px to approximately 18px. |
| P1 | Labels sit against controls and focus outlines; Competing wraps an input and another interactive button inside one label. | ScoreEvent.tsx, EntryForms.css | Separate associated labels and field groups, with measured 10–11px label/control gaps. Change remains a separate button; recorder information describes the input. |
| P1 | Composite controls clip keyboard focus rings. | styles.css | Participant group has an outer focus-within ring; individual controls and segmented buttons use inset focus outlines. |
| P1 | Bracket match selection is mouse-only. | Bracket.tsx | Populated matches expose button semantics, keyboard Enter/Space selection, a meaningful name and pressed state. |
| P1 | Bracket team and correction inputs rely on placeholders. | Bracket.tsx | Persistent labels added for participant, team and correction fields. Correction reason appears only when correcting a recorded winner. |
| P2 | Native dropdown height and appearance differ from adjacent inputs. | Events.tsx, Standings.tsx, Admin.tsx | Replaced all eight native selectors with ThemedSelect. Events search and dropdown both measure 56px and share the same top coordinate. |
| P2 | Mobile menu and dismiss controls lack complete accessible states/names. | shared.tsx | Menu exposes expanded state and its controlled navigation, swaps Open/Close labels and closes on navigation. Notification dismiss is named. |
| P2 | Small hit areas make mobile interaction difficult. | styles.css | Navigation, back links, checkbox rows, suggestions and icon controls have at least 44px target height; sign-out remains available in mobile Admin navigation. |
| P2 | Long labels and compact controls crowd narrow screens. | Results.css, styles.css, Welcome.tsx | Results text wraps within a constrained grid; pills wrap; long headings have safer line height; mobile presentation actions use two columns; Continue text can wrap. |
| P2 | Long attempt labels are cramped in half-width Admin selector. | Admin.tsx | Attempt selector spans the row; original and corrected values appear beneath it. Dropdown options wrap fully and duration values are formatted. |
| P2 | Native checkbox accent and low-contrast placeholder treatment drift from the theme. | styles.css | Lime checkbox/caret/selection treatment and explicit muted placeholder color. |
| P2 | Historical results referencing a missing event can break the screen. | Results.tsx, Admin.tsx | Guarded score formatting retains a readable fallback. |
| P3 | Blanket near-zero animation duration suppresses state feedback. | styles.css | Reduced-motion treatment removes hover movement while preserving visible color/border feedback. Dropdown motion has a scoped reduced-motion alternative. |

Resolved findings: 5 P1, 7 P2, 1 P3; no P0 findings. The existing bundle warning is retained as a performance follow-up, not silently treated as resolved.

## Verification

- `npm run check`: TypeScript, 24 existing domain/fixture/audit regression tests, and production build pass.
- Mechanical scan of changed UI files: `detect.mjs --json` returned `[]`.
- Browser inspected Events, distance entry, stopwatch, Welcome, bracket display/correction, Admin, Results, and Standings at mobile/desktop sizes. Main pages had document widths equal to their viewport widths. Admin lazy loading was checked separately after content appeared.
- Category dropdown: pointer filtering, arrows, End, Enter, type-ahead and Escape cancellation checked. The active last option scrolls into the menu viewport; the page does not need to refresh.
- Mobile Admin dropdown verified inside the viewport with full readable option labels. Explicit labels remain visible above the controls.
- Keyboard selection of a semifinal opened the correction panel, exposed the selected match and winner, and displayed its labeled reason field.
- Existing scores, save behavior, ranking logic and Firebase listeners remain in use. Browser checks used local sample data.
- Screenshots are in [screenshots/design-audit](screenshots/design-audit), including [the focused result field](screenshots/design-audit/focused-result.png) and [mobile event editor](screenshots/design-audit/mobile-admin.png).
- Released to the Firebase review channel at 09:04 on September 22. Hosted smoke checks confirmed the latest assets, corrected Truck Pull spacing and labels, and the matching 56px custom category filter. [Open the updated review](https://uncommon-men--review-bnh40gxr.web.app/events?demo=1&review=20260922-design).

## Remaining performance follow-up

The main bundle still triggers Vite's size advisory (about 1.1 MB minified / 296 KB gzip, including Firebase). An `$impeccable optimize` pass should measure first-load performance on the venue network before deciding whether further splitting helps. Finish any subsequent changes with `$impeccable polish`; the present layout repairs do not require another redesign.
