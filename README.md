# Uncommon Men

A responsive conference competition hub with event entry, real-time standings, single-elimination brackets, and audited administration.

Review build: https://uncommon-men--review-bnh40gxr.web.app/?demo=1 (browser-local sample data; expires October 22, 2026). Remove `?demo=1` to connect to the real conference. The live database has the event catalog and no practice results.

## Local development

```sh
npm ci
cp .env.example .env.local
# Fill .env.local with the project's Firebase web app configuration.
npm run dev
```

Open `http://localhost:5173/?demo=1` for the explicit local demonstration. Demo data is isolated from Firebase. Open the same URL without `demo=1` for live Firebase. Demo administrator access never grants a Firebase administrator role.

## Architecture

- React + TypeScript + Vite. Barlow and Barlow Condensed fonts are self-hosted.
- Firebase web SDK 12.19.0, verified against the package registry on September 22, 2026.
- Anonymous Firebase Authentication gives each browser a stable recorder UID; the display name is self-reported. Google sign-in and the `admin` custom claim protect administration.
- Firestore Enterprise native database `conference`, region `us-central1`, with realtime updates enabled.
- Firestore snapshot listeners propagate saves and corrections without refreshing. Realtime subscriptions are required for presentation mode; one-shot database pipeline queries do not fulfill this requirement.
- Every persistent mutation is paired with an append-only audit entry. Corrections preserve original values and require reasons.
- Before a bracket starts, anyone with a recorder name can sign up existing or newly added players. Team registration automatically joins that event's bracket. Signups are saved immediately and shown to everyone. An administrator starts play with all registered entrants; later additions require an administrator and remain locked after the first recorded result.
- Lightning / Knockout uses one shared game: everyone signs up before play starts, an administrator starts the game, and the last player standing is recorded as the winner. The archived legacy bracket document remains preserved for audit history and is ignored by knockout rules.
- Timed results are stored as seconds. The stopwatch is an input mechanism; a stopped timer is reviewed before an explicit save.
- The profile icon/name opens the remembered-name editor and returns to the originating activity. Name changes use the existing audited identity flow; editing your own name renames the linked participant in place while preserving results and team memberships; administrators can rename other participants.
- View attempts expands the current activity's history for the selected competitor beneath the entry form. It updates from the shared snapshot after saves, retains best-attempt markers, and does not navigate away. My Results remains available for history across activities.

## Scoring

The best valid attempt counts. First through eighth place receive 10, 8, 6, 5, 4, 3, 2, 1 points. Ties share their rank and average the points for occupied positions. Category and overall standings sum every active individual event. Team championships are separate. Bracket points are awarded when the bracket is complete; players eliminated in the same round share placement.

Knockout points are awarded only after the game is complete: the winner receives 10 points and value 1; every other registered participant receives 0 points and value 0. Registration and active games do not appear in standings.

The built-in catalog contains the approved conference activities only. Administrators can adjust scoring and instructions in the app.

## Checks

```sh
npm run typecheck
npm test
npm run build
# Separate terminal, isolated demo project:
npx -y firebase-tools@latest emulators:start --only auth,firestore --project demo-uncommon-men
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npm run test:rules
```

Before browser testing with emulators, seed their named database:

```sh
FIREBASE_PROJECT_ID=demo-uncommon-men FIREBASE_DATABASE_ID=conference FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 ADMIN_EMAIL=qa@example.com npx tsx scripts/provision.ts
```

Then run the frontend with `VITE_FIREBASE_EMULATORS=true` and `VITE_FIREBASE_PROJECT_ID=demo-uncommon-men`. An empty named database intentionally shows a setup error.

## Administration and provisioning

The initial administrator is configured using the authenticated project operator, not a browser-supplied flag. The idempotent provisioning script adds missing catalog records with audit entries and sets the specified administrator claim. It creates no sample results.

```sh
ADMIN_EMAIL=your-email@example.com npx tsx scripts/provision.ts
```

After an administrator role change, sign out and sign in again to refresh the Firebase token. No private service-account key belongs in the frontend or repository.

### Admin access

Administrators must first sign in with Google. The admin panel is available at `/admin` after the signed-in account has the Firebase Auth custom claim `admin: true`. To grant or revoke that claim for an existing Firebase Auth user, use the dedicated operator CLI. It never creates users and preserves all custom claims other than `admin`. The CLI defaults Google ADC's quota project to the selected Firebase project; set `GOOGLE_CLOUD_QUOTA_PROJECT` explicitly when your operator setup requires a different quota project:

```sh
gcloud auth application-default login
gcloud auth application-default set-quota-project uncommon-men # if ADC reports a quota-project error
npx tsx scripts/admin-access.ts grant your-email@example.com
npx tsx scripts/admin-access.ts revoke your-email@example.com
```

Set `FIREBASE_PROJECT_ID` when operating on another Firebase project:

```sh
FIREBASE_PROJECT_ID=your-project-id npx tsx scripts/admin-access.ts grant your-email@example.com
```

After granting or revoking access, the user must sign out and sign in again. Firebase ID tokens are cached for about one hour, so a revoked role can continue to work until the cached token expires or the user signs in again; do not treat revocation as an instant session shutdown. The `?demo=1` administrator shown in the local sample is intentionally local sample data and never grants a Firebase administrator role.

## Design references

The six approved mockups are in `docs/mockups/`. Implementation decisions and verification gates are documented in `docs/IMPLEMENTATION_PLAN.md`. Visual comparison evidence is recorded in `docs/VERIFICATION.md` after review.
