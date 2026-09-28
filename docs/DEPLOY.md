# Production deploy: multi-conference release

Runbook for deploying the multi-conference release (`conferences/{cid}/...`,
organizer and conference-admin roles, `/` directory, `/organizer`, in-app
signs) to the `uncommon-men` Firebase project, named Firestore database
`conference`, Hosting site `uncommon-men` (https://uncommon-men.web.app).

Everything runs non-interactively with `firebase-tools` and a `FIREBASE_TOKEN`
(from `firebase login:ci`). The token belongs to a Google account that is an
Owner or Editor of the project (or at least holds Firebase Hosting Admin,
Firebase Rules Admin and Cloud Datastore User).

```sh
export FIREBASE_TOKEN=...            # never commit it or paste it into logs
FB="npx -y firebase-tools@latest --project uncommon-men --non-interactive"
```

## Why the order matters

| State | Old app (cached tabs, old bundle) | New app |
| --- | --- | --- |
| Data migrated, old rules + old hosting | works (reads top-level) | n/a |
| New rules, old hosting | **broken**: top-level collections are denied | n/a |
| New hosting, old rules | n/a | **broken**: `conferences/...` is denied, every conference shows "Conference not found" |
| New hosting + rules, data not migrated | broken | legacy QR links land on "Conference not found" until the migration creates `conferences/uncommon-men-2026` (the page then recovers without a reload) |

So: **migrate first** (invisible to the old app, which the old rules keep away
from `conferences/`), then release **rules and hosting in one command**, then
run the migration a **second time** to pick up anything the old app wrote in
between (the new rules freeze the legacy collections, so the second pass is final).

Do it in a quiet period, not during competition. Browsers that loaded the old
app within the previous hour keep the old `index.html` (Hosting served it with
`max-age=3600`; this release changes that to `no-cache`), and the old bundle
cannot read anything under the new rules. Those visitors must reload once.

## 1. Pre-flight

```sh
git status                    # clean, on the commit being deployed
npm ci
npm run check                 # typecheck, unit tests, production build
npx -y firebase-tools@latest emulators:exec --only auth,firestore --project demo-uncommon-men \
  "FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 npm run test:rules"
$FB projects:list >/dev/null  # the token works
$FB deploy --only firestore:rules,firestore:indexes,hosting --dry-run   # rules compile against the project; nothing is released
```

### Web app config for the production build

The build embeds the public Firebase web config from `VITE_FIREBASE_*`
(`.env.local` / `.env.production.local`, both gitignored). Without it the
built app shows "Firebase is not configured". The config is public (it ships
in the bundle); fetch it rather than copying it by hand. The live site uses web
app `1:575277768262:web:5edc59ce502185d5ac3447` (`$FB apps:list WEB` shows all).

```sh
$FB apps:sdkconfig WEB 1:575277768262:web:5edc59ce502185d5ac3447 --out /tmp/uncommon-men-sdk.json
node -e '
const c = require("/tmp/uncommon-men-sdk.json");
const lines = {
  VITE_FIREBASE_API_KEY: c.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: c.authDomain,         // uncommon-men.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID: c.projectId,           // uncommon-men
  VITE_FIREBASE_APP_ID: c.appId,
  VITE_FIREBASE_DATABASE_ID: "conference",
  VITE_FIREBASE_EMULATORS: "false",
};
for (const [k, v] of Object.entries(lines)) if (!v) throw new Error("missing " + k);
require("fs").writeFileSync(".env.production.local", Object.entries(lines).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");'
rm /tmp/uncommon-men-sdk.json
npm run build
grep -l "uncommon-men.firebaseapp.com" dist/assets/*.js   # the config made it into the bundle
```

Make sure no other `.env*` file (for example a local `.env.local` with
`VITE_FIREBASE_EMULATORS=true` or a demo project id) overrides these values:
`.env.production.local` wins over `.env.local` for `vite build`.

### Credentials for the Node scripts (migration, backup)

The scripts use `firebase-admin` with `applicationDefault()`: Google
Application Default Credentials (ADC). **A `FIREBASE_TOKEN` is not ADC**, so
the scripts cannot use it directly. Two options:

- **Operator machine (preferred):** `gcloud auth application-default login`
  (and `gcloud auth application-default set-quota-project uncommon-men` if a
  quota-project error appears), with an account that has Firestore access.
- **CI with only `FIREBASE_TOKEN`:** the token is an OAuth refresh token for
  the Firebase CLI's public OAuth client, issued with the `cloud-platform`
  scope. `firebase-tools` itself turns it into an `authorized_user` ADC file for
  its emulators; do the same, in a private temp file, and delete it afterwards:

  ```sh
  ADC=$(mktemp) && chmod 600 "$ADC"
  node -e '
  require("fs").writeFileSync(process.argv[1], JSON.stringify({
    type: "authorized_user",
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",   // Firebase CLI public client, same values as firebase-tools
    refresh_token: process.env.FIREBASE_TOKEN,
    quota_project_id: "uncommon-men",
  }));' "$ADC"
  export GOOGLE_APPLICATION_CREDENTIALS="$ADC"
  # ... run the scripts ...
  rm -f "$ADC"; unset GOOGLE_APPLICATION_CREDENTIALS
  ```

  The file carries the same power as the token itself. If the scripts fail with
  `invalid_grant`, the token was revoked or expired; create a new one.

A service-account key would also work but is deliberately not used (no private
keys in this project).

## 2. Backups (before any write)

1. **Hosting**: keep the current live release addressable for rollback.

   ```sh
   $FB hosting:channel:create pre-multiconf --expires 30d
   $FB hosting:clone uncommon-men:live uncommon-men:pre-multiconf
   ```

2. **Rules**: the current production rules are `firestore.rules` at commit
   `4dcdbf4` (also visible in the console's rules history).

3. **Firestore**, either or both:
   - Server-side clone (token only; pick an unused database id). If the
     command reports that cloning is not supported for this database, rely on
     the JSON snapshot below:

     ```sh
     $FB firestore:databases:clone conference conference-pre-multiconf
     $FB firestore:operations:list --database conference   # wait for the clone to finish
     ```

     Delete it once the release is confirmed: `$FB firestore:databases:delete conference-pre-multiconf --force`.
   - JSON snapshot of every document (needs the ADC above; writes to the
     gitignored `backups/`):

     ```sh
     npx tsx scripts/backup-firestore.ts
     ```

   The migration never modifies or deletes the legacy top-level collections,
   so they remain an in-place copy of the pre-release data as well.

## 3. Migration, pass 1

Set the conference details explicitly: without dates the script uses the span
of recorded attempts, or today when there are none (the live database has no
practice results). Confirm the dates and location with the organizers.

```sh
export FIREBASE_PROJECT_ID=uncommon-men FIREBASE_DATABASE_ID=conference CONFERENCE_ID=uncommon-men-2026
export CONFERENCE_NAME="Uncommon Men 2026" CONFERENCE_START_DATE=YYYY-MM-DD CONFERENCE_END_DATE=YYYY-MM-DD CONFERENCE_LOCATION="..."
npx tsx scripts/migrate-to-multi-conference.ts --dry-run
```

Check the dry run: the first line says `uncommon-men/conference -> conferences/uncommon-men-2026`;
no "unrecognized top-level collections" beyond what you expect; `toCopy`
equals `legacy` for every collection on the first run. Then:

```sh
npx tsx scripts/migrate-to-multi-conference.ts
```

It must end with `Verified: every legacy document exists under the conference.`
The old app is unaffected (the old rules deny `conferences/` and `settings/`).

## 4. Release rules, indexes and hosting together

Build first (step 1), then one command so the rules and hosting releases are
seconds apart (firebase-tools uploads both, then releases Firestore before Hosting).
Do **not** run a bare `firebase deploy`: `firebase.json` also has an `auth`
section.

```sh
$FB deploy --only firestore:rules,firestore:indexes,hosting --message "Multi-conference release $(git rev-parse --short HEAD)"
```

## 5. Migration, pass 2 (immediately)

```sh
npx tsx scripts/migrate-to-multi-conference.ts
```

Expected: `toCopy` is 0 (or only documents recorded by the old app between
pass 1 and step 4, which it now copies) and `keptDifferent` is 0. Any
`Kept (destination differs from legacy): ...` line names a legacy document the
old app changed after pass 1 (a rename, a correction, a bracket result); the
copy is never overwritten, so compare the two documents (legacy
`<collection>/<id>` vs `conferences/uncommon-men-2026/<collection>/<id>`) and
re-enter the change in the app. Then remove the temporary ADC file.

## 6. Smoke tests (production)

```sh
curl -sI https://uncommon-men.web.app/events/push-up | grep -i cache-control      # no-cache
curl -sI https://uncommon-men.web.app/ | grep -i cache-control                    # no-cache
```

In a private browser window (fresh anonymous user), then on a phone:

1. `https://uncommon-men.web.app/events/push-up` (a printed QR code) redirects
   to `/c/uncommon-men-2026/welcome?next=/events/push-up`; after entering a
   name it opens `/c/uncommon-men-2026/events/push-up`.
2. `https://uncommon-men.web.app/standings`, `/results`, `/admin`,
   `/events?demo=1` and an unknown path all land under `/c/uncommon-men-2026/`
   with the query string kept.
3. `https://uncommon-men.web.app/` shows the directory with "Uncommon Men 2026"
   (correct dates and location) under current conferences.
4. Record an attempt on a count event; it appears in Standings without a reload
   (use a clearly named test participant, then invalidate it from the admin
   corrections panel with a reason, or remove it with `reset-competition.ts`
   before the event).
5. Sign in with Google at `/c/uncommon-men-2026/admin` as an organizer: the
   Audit tab shows the migrated history and the test attempt; the Conference tab
   shows the conference and its admins.
6. `/c/uncommon-men-2026/admin/signs`: every active event has a sign; the QR
   and printed URL are `https://uncommon-men.web.app/c/uncommon-men-2026/events/<eventId>`.
   Scan one with a phone.
7. `/organizer` as an organizer: the conference list, organizers and platform
   audit load. As a non-organizer Google account: access is refused.
8. A returning device that already had a name keeps it (its identity and
   participant were migrated with the same ids).

## 7. Rollback

- **Hosting only** (a UI bug; data and rules are fine): redeploy a fixed build,
  or `$FB hosting:clone uncommon-men:pre-multiconf uncommon-men:live` only
  together with the rules rollback below (the old app needs the old rules).
- **Full rollback** to the single-conference release:

  ```sh
  git worktree add /tmp/uncommon-men-rollback 4dcdbf4
  (cd /tmp/uncommon-men-rollback && npx -y firebase-tools@latest deploy --only firestore:rules \
     --project uncommon-men --non-interactive)
  $FB hosting:clone uncommon-men:pre-multiconf uncommon-men:live
  git worktree remove /tmp/uncommon-men-rollback
  ```

  The legacy collections were never touched, so the old app sees exactly the
  data it had at step 4. Anything recorded in the new app after step 4 exists
  only under `conferences/uncommon-men-2026/...` and would need to be copied back
  by hand (compare with the JSON backup). The new documents (`conferences`,
  `settings`, `platformRoles`, `platformAudit`) are invisible to the old rules
  and can stay for the next attempt.
- **Data** (only if the migration itself is wrong): the migration only adds
  documents; delete `conferences/uncommon-men-2026` recursively
  (`$FB firestore:delete conferences/uncommon-men-2026 --recursive --database conference --force`)
  and `settings/platform`, fix, and run it again. Never do this after the new
  app has recorded results.

## 8. Afterwards

- Keep the legacy top-level collections until the owner confirms the
  migration; they are unreachable by clients under the new rules.
- Delete the `pre-multiconf` channel and the cloned database when no longer needed.
- Revoke the CI token if it was created only for this release (`firebase logout --token <token>`).
