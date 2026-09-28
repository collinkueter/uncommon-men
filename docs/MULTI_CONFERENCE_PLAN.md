# Multi-conference and event-sign plan

Decisions (confirmed by the product owner):

1. URLs use a path prefix: `/c/:slug/events`, `/c/:slug/events/:eventId`, `/c/:slug/standings`, `/c/:slug/results`, `/c/:slug/admin`, `/c/:slug/welcome`.
2. Creating conferences is a **role**, not a hard-coded person. Anyone holding the organizer role can create conferences and grant roles (Collin today, Randy next).
3. Participants are **separate per conference**. A person's name, identity link, results and teams belong to one conference only.

## Roles

| Role | Stored as | Can |
| --- | --- | --- |
| Organizer (platform) | Firebase custom claim `admin: true` (legacy, bootstrapped by `scripts/admin-access.ts`) **or** a Firestore doc `platformRoles/{lowercased Google email}` with `{ role: 'organizer' }` | Create conferences, edit any conference, grant/revoke organizer and conference-admin roles, change the default conference |
| Conference admin | Firestore doc `conferences/{cid}/admins/{lowercased Google email}` | Everything the old `/admin` page allowed, scoped to that one conference |
| Recorder | Anonymous or Google sign-in | Unchanged: enter results, sign up, etc. within a conference |

Email-based roles require a Google sign-in with `email_verified == true`; rules compare `request.auth.token.email.lower()`.

## Data layout

```
settings/platform                 { defaultConferenceId }
platformRoles/{email}             { role: 'organizer', auditId }
platformAudit/{id}                audit entries for platform-level changes
conferences/{cid}                 { name, slug (== cid), startDate, endDate, location, status: 'draft'|'live'|'archived', createdAt, auditId }
conferences/{cid}/admins/{email}  { email, auditId }
conferences/{cid}/categories|events|participants|teams|attempts|brackets|games|identities|audit/...
```

The existing single conference migrates to `conferences/uncommon-men-2026` (name "Uncommon Men 2026", status `live`), and `settings/platform.defaultConferenceId = 'uncommon-men-2026'`. Top-level legacy collections stay in place, untouched, until the owner confirms the migration.

`draft` conferences are visible only to their admins and organizers. `archived` conferences are read-only for everyone (no writes to any subcollection).

## Legacy URLs

Printed QR codes point at `https://uncommon-men.web.app/events/<eventId>`. Every legacy path (`/`, `/events`, `/events/:id`, `/standings`, `/results`, `/admin`, `/welcome`) redirects to the same path under `/c/<defaultConferenceId>/`, preserving `?demo=1`.

## Event signs

`/c/:slug/admin/signs` renders one letter-size sign per active event from live data, with a QR code generated in the browser pointing at `https://<origin>/c/<slug>/events/<eventId>`, plus a conference poster whose QR opens `/c/<slug>/events`. Printing uses the browser's Save as PDF with a print stylesheet (one sign per page).
