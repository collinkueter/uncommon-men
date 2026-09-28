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

Open `http://localhost:5173/?demo=1` for the explicit local demonstration: the conference directory, with the sample conference at `/c/uncommon-men-2026/...?demo=1`. Demo data is isolated from Firebase and stored in the browser: the demo platform (conference list, default conference, organizers, conference admins) and each conference's data per slug, so `/c/<any-slug>/events?demo=1` shows a separate sample conference. In demo mode the demo administrator is also an organizer, so `/organizer?demo=1` can create, archive and configure conferences locally. Open the same URL without `demo=1` for live Firebase. Demo administrator access never grants a Firebase administrator role.

## Architecture

- React + TypeScript + Vite. Barlow and Barlow Condensed fonts are self-hosted.
- Firebase web SDK 12.19.0, verified against the package registry on September 22, 2026.
- Anonymous Firebase Authentication gives each browser a stable recorder UID; the display name is self-reported. Google sign-in plus an organizer or conference-admin role protects administration (see [Conferences and roles](#conferences-and-roles)).
- Firestore Enterprise native database `conference`, region `us-central1`, with realtime updates enabled.
- Multiple conferences share one deployment. `/` is the conference directory (live conferences first, then "Past conferences"; drafts only for organizers; a filter appears above six conferences) and `/organizer` is the organizer area. Every conference URL is prefixed with the conference slug: `/c/:slug/{welcome,events,events/:eventId,standings,results,admin}`, and its header shows the conference name with a switcher to the other conferences. Legacy paths (`/events`, `/events/:eventId`, `/standings`, `/results`, `/admin`, `/welcome`, and unknown paths, as printed on QR codes) redirect to the same path under `/c/<defaultConferenceId>/`, keeping the query string (`?demo=1`). The default comes from `settings/platform`, read once per page, falling back to `uncommon-men-2026`.
- `ConferenceProvider` (`src/lib/ConferenceContext.tsx`) takes the conference id from the route and creates one store per conference with `createConferenceStore(conferenceId)` (`src/data/store.ts`); switching conferences disposes the previous store. The Firebase app, Auth and Firestore instances are page-wide singletons (`src/data/firebase.ts`). Internal links go through `useConferenceLink()` (`src/ui/shared.tsx`), which adds the `/c/<slug>` prefix and `?demo=1`.
- A missing conference, or a draft the viewer may not see, shows "Conference not found". In an archived conference every entry form is disabled with a read-only notice, and the store and rules reject writes.
- Firestore snapshot listeners propagate saves and corrections without refreshing. Realtime subscriptions are required for presentation mode; one-shot database pipeline queries do not fulfill this requirement.
- Every persistent mutation is paired with an append-only audit entry. Corrections preserve original values and require reasons.
- Before a bracket starts, anyone with a recorder name can sign up existing or newly added players. Team registration automatically joins that event's bracket. Signups are saved immediately and shown to everyone. An administrator starts play with all registered entrants; later additions require an administrator and remain locked after the first recorded result.
- Lightning / Knockout uses one shared game: everyone signs up before play starts, an administrator starts the game, and the last player standing is recorded as the winner. The archived legacy bracket document remains preserved for audit history and is ignored by knockout rules.
- Timed results are stored as seconds. The stopwatch is an input mechanism; a stopped timer is reviewed before an explicit save.
- The profile icon/name opens the remembered-name editor and returns to the originating activity. Name changes use the existing audited identity flow; editing your own name renames the linked participant in place while preserving results and team memberships; administrators can rename other participants.
- View attempts expands the current activity's history for the selected competitor beneath the entry form. It updates from the shared snapshot after saves, retains best-attempt markers, and does not navigate away. My Results remains available for history across activities.

## Conferences and roles

Firestore layout (all conference data lives under its conference; participants, identities, results and teams are separate per conference):

```
settings/platform                 { defaultConferenceId, auditId }
platformRoles/{email}             { role: 'organizer', auditId }
platformAudit/{id}                audit entries for settings and platformRoles changes
conferences/{cid}                 { name, slug (== cid), startDate, endDate (YYYY-MM-DD), location, status: 'draft'|'live'|'archived', createdAt, auditId }
conferences/{cid}/admins/{email}  { email, auditId }
conferences/{cid}/categories|events|participants|teams|attempts|brackets|games|identities|audit/...
```

Roles (emails are lowercased document ids; email roles require a Google sign-in with a verified email):

| Role | Stored as | Can |
| --- | --- | --- |
| Organizer | Custom claim `admin: true` (legacy bootstrap) **or** `platformRoles/{email}` | Create conferences, change any conference's status, administer every conference, grant/revoke roles, change the default conference |
| Conference admin | `conferences/{cid}/admins/{email}` | Everything on `/c/<cid>/admin` for that one conference; edit its name, dates and location |
| Recorder | Anonymous or Google sign-in | Enter results and sign up within a live conference |

`firestore.rules` implements this with `organizer()` and `conferenceAdmin(cid)`; inside `match /conferences/{cid}`, `admin()` is `conferenceAdmin(cid)`. Draft conferences and their data are readable only by `conferenceAdmin(cid)`; archived conferences reject every subcollection write. Every write stays audited: conference data (including the conference document and its admins) in `conferences/{cid}/audit`, platform settings and organizer roles in `platformAudit`. Revoking a role deletes its document together with an audit entry whose id is `<grant auditId>-revoke`.

Platform data outside a conference (the conference list, `settings/platform`, `platformRoles`, `platformAudit`) is served by a separate page-wide store, `createPlatformStore()` in `src/data/platform.ts` (realtime listeners; browser-local under `?demo=1`), through `usePlatform()` (`src/lib/PlatformContext.tsx`). Its audited writes live in `src/data/platformWrites.ts` and are exercised directly by the rules tests. Everyone but organizers lists conferences with `where('status', 'in', ['live', 'archived'])`, because rules are not filters. A conference admin whose conference is still a draft reaches it by its link; the directory lists drafts only for organizers.

Creating a conference (`planConferenceCreation` in `src/domain/conferences.ts`) writes, as document + audit pairs: the conference as a draft, the creator's identity in it (catalog audits must name a conference identity, so the creator joins that conference's roster under their Google name when they open it), the initial admins, every category and the selected events of the source (the built-in catalog or another conference; participants, teams and results are never copied). Pairs are committed in batches of at most five so each batch stays within the rules' limit of 20 document lookups, and a conference requested live is published only after every batch succeeded.

The app's `Identity.admin` means "conference admin of this conference" and `Identity.organizer` means organizer; the store computes both from the custom claim and live listeners on the signed-in verified email's `platformRoles` and `admins` documents, so email-based grants and revocations apply without signing in again.

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

Or run the rules tests in one command: `npx -y firebase-tools@latest emulators:exec --only auth,firestore --project demo-uncommon-men "FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npm run test:rules"`.

Before browser testing with emulators, seed their named database (add `CONFERENCE_ID=<slug>` and optionally `CONFERENCE_STATUS=draft|archived` to provision further conferences):

```sh
FIREBASE_PROJECT_ID=demo-uncommon-men FIREBASE_DATABASE_ID=conference FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 ADMIN_EMAIL=qa@example.com npx tsx scripts/provision.ts
```

Then run the frontend with `VITE_FIREBASE_EMULATORS=true` and `VITE_FIREBASE_PROJECT_ID=demo-uncommon-men`. A conference without its catalog intentionally shows a setup error; an unknown conference shows "Conference not found".

## Administration and provisioning

The initial administrator is configured using the authenticated project operator, not a browser-supplied flag. The idempotent provisioning script creates the conference document (if missing), `settings/platform` (if missing, pointing at this conference), and the missing catalog records with audit entries, and sets the specified organizer claim. It creates no sample results. Maintenance scripts (`provision.ts`, `reset-competition.ts`, `sync-event-instructions.ts`, `admin-access.ts`) act on `CONFERENCE_ID` (default `uncommon-men-2026`); `FIREBASE_PROJECT_ID` and `FIREBASE_DATABASE_ID` select the project and database. The older one-off migration scripts (`add-bicep-curl-20-lb.ts`, `migrate-dumbbell-hold-15lb.ts`, `migrate-lightning-knockout.ts`, `retire-chess-checkers.ts`) operate on the legacy top-level layout and are kept for history only.

```sh
ADMIN_EMAIL=your-email@example.com npx tsx scripts/provision.ts
CONFERENCE_ID=fall-2027 CONFERENCE_NAME="Fall 2027" CONFERENCE_START_DATE=2027-10-01 CONFERENCE_END_DATE=2027-10-03 CONFERENCE_STATUS=draft ADMIN_EMAIL=your-email@example.com npx tsx scripts/provision.ts
```

### Migrating the single-conference database

`scripts/migrate-to-multi-conference.ts` copies every legacy top-level collection (categories, events, participants, teams, attempts, brackets, games, identities, audit) into `conferences/uncommon-men-2026/...`, preserving document ids and every field value including timestamps, creates the conference document (name "Uncommon Men 2026", status `live`; dates from `CONFERENCE_START_DATE`/`CONFERENCE_END_DATE`, otherwise the span of recorded attempts) and `settings/platform`. It is idempotent: documents already at the destination are never overwritten. It verifies that every legacy document exists at its destination and never modifies or deletes legacy data; the legacy collections stay until the owner confirms the migration.

```sh
npx tsx scripts/migrate-to-multi-conference.ts --dry-run
npx tsx scripts/migrate-to-multi-conference.ts
```

Deploy the new `firestore.rules` and the app together, after the migration: the new rules no longer serve the top-level collections.

After an administrator role change, sign out and sign in again to refresh the Firebase token. No private service-account key belongs in the frontend or repository.

### Admin access

Administrators must first sign in with Google. The admin panel is available at `/c/<slug>/admin` (legacy `/admin` redirects to the default conference) for organizers and that conference's admins; its Conference tab edits the conference's name, dates and location (conference admins, while it is not archived), lists its admins, and for organizers changes its status, grants and revokes its admins, and links to `/organizer`. Organizer and conference-admin roles are Firestore documents keyed by the lowercased Google email and take effect without signing in again.

#### Organizer area (`/organizer`)

Organizers sign in with Google at `/organizer` to:

- create conferences (name, web address suggested from the name, dates, location, draft or live, starting events from the built-in catalog or copied from another conference with per-event checkboxes, optional conference-admin emails);
- publish, archive and unarchive conferences, edit their details, manage each conference's admins, and set the default conference (where legacy links and printed QR codes land);
- add and revoke organizers, and review organizer activity (`platformAudit`).

To add Randy as an organizer from the app: sign in at `https://uncommon-men.web.app/organizer` with an organizer account, open **Organizers**, enter Randy's Google email and choose **Add organizer**. Randy then signs in at `/organizer` with that same Google account (it must be the Google account for that exact email); access applies immediately. Revoke it from the same list. Organizers holding the legacy `admin` custom claim are not listed there; manage them with the CLI below.

The same roles can be granted from the operator CLI:

```sh
npx tsx scripts/admin-access.ts grant-organizer randy@example.com
npx tsx scripts/admin-access.ts revoke-organizer randy@example.com
CONFERENCE_ID=uncommon-men-2026 npx tsx scripts/admin-access.ts grant-conference-admin helper@example.com
CONFERENCE_ID=uncommon-men-2026 npx tsx scripts/admin-access.ts revoke-conference-admin helper@example.com
```

The legacy Firebase Auth custom claim `admin: true` also makes an account an organizer. To grant or revoke that claim for an existing Firebase Auth user, use the same operator CLI. It never creates users and preserves all custom claims other than `admin`. The CLI defaults Google ADC's quota project to the selected Firebase project; set `GOOGLE_CLOUD_QUOTA_PROJECT` explicitly when your operator setup requires a different quota project:

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

After granting or revoking the custom claim, the user must sign out and sign in again. Firebase ID tokens are cached for about one hour, so a revoked role can continue to work until the cached token expires or the user signs in again; do not treat revocation as an instant session shutdown. The `?demo=1` administrator shown in the local sample is intentionally local sample data and never grants a Firebase administrator role.

## Event signs

Printed event signs are generated in the app, not maintained offline. An administrator opens `/admin/signs`, picks the active events to print (or "Print all"), optionally adds the conference poster, and prints with the browser's print dialog (Save as PDF works well) — one letter-size sign per page, each with a QR code generated in the browser that opens straight into that event. The sign content (name, category, how-to-play instructions, scoring summary, and the QR target) is derived live from the event catalog, so it always matches what administrators have configured.

## Design references

The six approved mockups are in `docs/mockups/`. Implementation decisions and verification gates are documented in `docs/IMPLEMENTATION_PLAN.md`. Visual comparison evidence is recorded in `docs/VERIFICATION.md` after review.
