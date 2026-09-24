# Implementation verification — September 22, 2026

## Firebase

- Project: `uncommon-men`; native Enterprise Firestore database: `conference`; region: `us-central1`; realtime enabled.
- Firebase web SDK pinned to `12.19.0`, confirmed with `npm view firebase version` on this date.
- Anonymous authentication and Google administrator sign-in configured. Administrator role is a server-issued custom claim.
- Snapshot listeners synchronize public catalog, participants, teams, attempts and brackets; audit subscriptions are administrator-only. Listener cleanup and auth transitions are handled explicitly.
- Persistent multi-tab cache uses `persistentLocalCache` with `persistentMultipleTabManager`. Cached standings remain readable offline; transactional writes need connectivity.
- Every application mutation is atomic with an immutable audit entry. Rules bind recorder identity and audit before/after values to the written documents. Retries reuse attempt IDs; revisions prevent stale corrections and bracket overwrites.
- Production catalog checked through the Admin SDK: 7 categories, 19 events, 0 test attempts.

## Automated checks

- TypeScript typecheck and production build pass.
- 16 domain/fixture tests pass: ranking direction, best valid attempts, ties and point totals, team separation, bracket advancement/byes/correction propagation and time formatting.
- 11 Firestore emulator rules tests pass, including the six-write first-result transaction, unauthorized edits, audit integrity and constrained bracket winner advancement.
- Production dependency audit: zero known vulnerabilities.
- Build reports a large main bundle (approximately 294 KB gzip, including Firebase and React); admin UI is a separate lazy-loaded chunk.

## Browser integration

Tests used an isolated Firebase Emulator project, `demo-uncommon-men`, with its named `conference` database.

- First-use name entry creates an audited recorder identity; reload restores the recorder.
- A participant's own count and a volunteer-entered count both save with distinct participant/recorder identity.
- A second browser view changes rank after a best attempt increases from 12 to 20 without refreshing the display.
- An administrator corrects a volunteer result from 15 to 25 with a reason. The display updates automatically; server inspection confirms revision 2 and an audit preserving 15 before / 25 after.
- Stopwatch Start/Stop captures elapsed time and preserves the stopped value across reload.
- Manual leaderboard selection, later pages and timed auto-cycle work together. Team displays use actual bracket outcomes, with pending entrants explicitly unranked.
- Hosted demo onboarding loads successfully.

The first browser save uncovered an empty named emulator catalog, previously concealed by client fallback events. The fallback was removed, an actionable setup error added, and the emulator catalog provisioned. No security rule relaxation was used to fix it.

## Mockup comparison

Approved concepts remain in `docs/mockups/`; browser captures are in `docs/screenshots/`.

| View | Comparison |
| --- | --- |
| Leaderboard | Charcoal/olive camouflage surround, lime leader, condensed athletic lettering, five readable rows, event selector and screen controls. |
| Welcome | Mobile name entry, remembered browser identity, participant suggestions and lime continuation button. |
| Event hub | Search/category filter, event cards with scoring labels, mobile bottom navigation. |
| Stopwatch | Competitor/recorder distinction, timer/manual tabs, large time, stopped review and explicit save. |
| Bracket | Round columns, highlighted winners and separate result panel. |
| Admin | Sidebar, correction form, reason and audit history; added event/category editors. |

The implementation follows the approved composition and visual direction, with responsive adaptations. The mockups are generated raster references, so lettering, icons and camouflage are recreated web assets rather than pixel-identical artwork. Screenshots are manual comparison evidence, not automated pixel-diff tests.

## Operational notes

- Review hosting channel expires October 22, 2026. Demo query `?demo=1` uses browser-local sample data. Without it, the same build uses the real conference database.
- Organizer should confirm scoring defaults before opening competition, especially truck pull, parkour, knockout and carpet ball.
- Production Google sign-in still needs the organizer's own end-to-end login check; administrator behavior and rules were tested with emulator claims.
- App Check, venue network/load testing, custom domain and permanent live-channel promotion are not included in the review deployment.
