# Uncommon Men implementation plan

## Accepted requirements

Match the six approved image mockups: charcoal and muted olive camouflage, acid lime highlights, condensed athletic display type, readable names and tabular scores. Build mobile event operation, public presentation, and administrator views. No poster slogans or registration features.

Anonymous browser identity remembers a self-reported name. Recorder and competitor are separate. Suggest existing participants by normalized name; create a participant on their first result. Keep every attempt and use the best valid attempt. Rank each individual event, category, and the conference; team championships remain separate. All individual events count equally. Placement points: 10, 8, 6, 5, 4, 3, 2, 1.

## Implementation decisions

- React, TypeScript, Vite, React Router; responsive CSS tokens and locally hosted fonts.
- Firebase anonymous Auth for participants and Google sign-in plus an administrator custom claim for admins. Self-reported names are not authorization.
- Firestore realtime subscriptions for live standings (this is why realtime queries are needed rather than one-shot pipeline queries). Named database `conference` in Iowa, pending actual project provisioning.
- Transactional audited writes. Before/after values, authenticated recorder UID, name snapshot, server timestamp, correction reason. Append-only audit history. No direct deletion of attempts.
- Public displays bypass onboarding; mutations require remembered identity. Explicit demonstration mode is separate from live data and never silently substitutes for Firebase errors.
- Stopwatch measures elapsed wall time, survives rerender/backgrounding, offers manual entry, and saves only after review. Duplicate submission protection and explicit error handling.
- Single-elimination brackets support byes, team or individual entrants, consistent advancement, and safe correction handling.
- Proposed tie rule: shared rank with averaged points for occupied positions. Bracket losers in the same round share their placement. This avoids inventing a third-place match.
- Initial event scoring defaults are configurable; organizer must verify truck pull, parkour, knockout, carpet ball, and can jam rules before competition begins.

## Work allocation

1. Primary: architecture, contract, project setup, Firebase provisioning, assets, integration and independent visual/functional review.
2. Sol: Firebase/demo store, audit transactions, security rules and focused security tests.
3. Terra: six mockup-matched screens and complete responsive interaction states.
4. Luna: scoring, category/overall aggregation, bracket progression, event catalog and meaningful domain tests.

## Acceptance gates

- Typecheck and production build pass.
- Domain tests cover best attempts, invalidations, ties, all-event totals, team exclusion, bracket byes and advancement/corrections.
- Emulator tests prove anonymous submissions work and unauthenticated writes, forged actor IDs, unaudited mutations and nonadmin edits fail.
- Browser verify remembered identity, suggestions, count/time/distance entry, stopwatch, save and repeated attempts, presentation controls, bracket winner entry and admin correction.
- Compare actual desktop/mobile screenshots against all six approved mockups, inspect legibility, contrast, layout and 44px touch targets; resolve material differences.
- Firebase setup is reported truthfully; no live deployment claimed before remote verification.
