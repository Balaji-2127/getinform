# External services & production keys

Every third-party service this app talks to, and every environment
variable it reads. Actual key values live only in `.env.local` (gitignored,
never committed) or in your hosting provider's environment-variable
settings for a real deployment — **this file intentionally does not
contain any live key values**, only what each one is for and where to get
one. `.env.example` has the same list with inline comments, kept in sync
with this file.

## Quick reference

| Variable | Service | Required to run? | What breaks without it |
|---|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps Platform | **Yes** | The map doesn't load at all — this is the core product. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase (Firestore) | **Yes** (server refuses to start without it) | No database connection at all — every campaign/search-history/saved-area route fails. |
| `SALES_LOGIN_PASSWORD` | — (app's own login gate) | **Yes** | No one can log in. |
| `SESSION_SECRET` | — (app's own session signing) | **Yes in production** (server refuses to start without it) | Dev falls back to an insecure default; production hard-fails on purpose. |
| `PORT` | — (app's own config) | No (defaults to 4000) | N/A |
| `GEMINI_API_KEY` + `GEMINI_FLASH_MODEL` | Google AI Studio (Gemini) | No | Client logos next to a campaign fall back to an initials badge instead of the real logo. |
| `SERPER_API_KEY` | Serper.dev | No | The property-photo thumbnail strip in the right-side panel just doesn't render. |
| `VITE_GOOGLE_MAPS_MAP_ID` | Google Maps Platform (Map styling) | No — **currently unused** | Nothing; see note below. |

"Required to run" means the feature is core, not optional — not that the
whole app crashes; most of these degrade gracefully to "that one feature
is off" rather than a hard failure (each one below says which).

---

## Hosting — this needs a real Node server, not Vercel

`server/index.ts` is a long-running Express server (`app.listen`). That
doesn't run on Vercel as-is: Vercel's default Vite preset only builds and
serves the static frontend (`vite build` → `dist/`) — it does not run
`npm start`, so nothing ever answers `/api/*` requests, which is why login
fails after a plain Vercel deploy.

**Use a host that runs a persistent Node process instead** — Render,
Railway, Fly.io, or similar. The existing scripts already match that model
directly, no code changes needed for the server itself:

- Build command: `npm run build`
- Start command: `npm run start`

**Set every env var from the table above** (as plain environment
variables in that host's dashboard, not committed anywhere) plus
`NODE_ENV=production`.

Unlike an earlier version of this app (which stored campaigns in a local
SQLite file), **no persistent disk is required anymore** — campaign data
lives in Firestore, reached over the network, so a free-tier host
restarting/redeploying the container no longer loses any data. The only
thing a free tier's auto-sleep still costs you is a slower first request
after it wakes back up, not data loss.

---

## Google Maps Platform — `VITE_GOOGLE_MAPS_API_KEY`

**What it's for:** the actual 3D map (Maps JavaScript API, `v=alpha`
channel, `maps3d` + `marker` libraries) — this is the product's main
screen. Loaded client-side in `src/google/loadGoogleMaps.ts`.

**Get one:** https://console.cloud.google.com/google/maps-apis/credentials
— requires a Cloud Billing account attached to the project (Google's own
requirement for this API, not something this app adds). Restrict the key
(HTTP referrers) to your production domain once you have one.

**Status:** confirmed working, in active use.

**`VITE_GOOGLE_MAPS_MAP_ID`** — a leftover from an earlier attempt to hide
Google's default POI icons (restaurants/shops/etc.) via Cloud-based Map
Styling. That attempt was abandoned (kept breaking 3D building rendering)
and the code was reverted to not use a Map ID at all. The variable is
still in `.env.example`/`.env.local` but nothing in `src/` reads it
anymore — safe to leave blank or remove.

---

## Firebase (Firestore) — `FIREBASE_SERVICE_ACCOUNT_JSON`

**What it's for:** `server/db.ts` — every campaign, saved area, and
search-history record. Replaced an earlier local-SQLite-file version of
this app specifically because that file lived on the host's own disk,
which most hosts (Render's free tier included) wipe on every container
restart or redeploy. Firestore is a real managed database reached over
the network, so persistence no longer depends on which container happens
to be running at the time.

**Get one:**
1. https://console.firebase.google.com → create a project (or reuse an
   existing one — this doesn't need to be dedicated to this app).
2. **Build → Firestore Database → Create database** — Native mode, any
   region close to your users.
3. **Project settings** (gear icon, top-left) → **Service accounts** tab
   → **Generate new private key**. This downloads a `.json` file —
   treat it like a password, it grants full read/write access to this
   Firestore project.
4. Paste that file's entire contents as the value of
   `FIREBASE_SERVICE_ACCOUNT_JSON`, as one single line, in `.env.local`
   (local dev) and in your host's environment-variable settings
   (production) — never commit the file itself.

**Status:** code is written and type-checks clean; **not yet verified
against a real Firestore project** — this needs an actual service-account
credential to confirm the connection and run a live read/write, the same
way every other service in this doc was tested directly before being
marked "confirmed working."

**Required** — the server throws a clear startup error
(`FIREBASE_SERVICE_ACCOUNT_JSON is not set`) rather than silently falling
back to anything, so a misconfigured deploy fails loudly and immediately
instead of quietly losing data later.

---

## Gemini API — `GEMINI_API_KEY` / `GEMINI_FLASH_MODEL`

**What it's for:** server-side only (`server/routes/branding.ts`). Given a
client's name (e.g. "Licious"), asks Gemini for that company's website
domain, then builds a logo URL from Google's public favicon service
(`https://www.google.com/s2/favicons`) using that domain — shown next to
a campaign's header. No key needed for the favicon fetch itself, only for
the domain lookup.

**Get one:** https://aistudio.google.com/apikey (Google AI Studio, not
Cloud Console — separate product, separate key).

**Status:** confirmed working, in active use. `GEMINI_FLASH_MODEL`
defaults to `gemini-2.5-flash` if unset.

**Degrades to:** an initials badge (e.g. "LI" for Licious) if unset or if
the lookup fails/returns nothing.

---

## Serper.dev — `SERPER_API_KEY`

**What it's for:** server-side only (`server/routes/propertyImages.ts`).
Searches Google Images for `"<property name>, <locality>"` and shows the
results as a thumbnail strip in the property inspector panel (right side
of the map) — real photos of the actual building, since the source
data's own Google Drive photo links require sign-in and aren't usable
directly.

**Why a third party and not Google's own Custom Search API:** tried that
first — confirmed by direct testing that Google's Custom Search JSON API
is closed to new Cloud projects entirely (`403: This project does not
have the access to Custom Search JSON API`), a known, permanent
new-customer restriction, not something fixable by enabling APIs or
billing. Serper.dev proxies real Google Search/Images results without
that restriction.

**Get one:** https://serper.dev — sign up with email, key is on the
dashboard immediately. No Cloud project, no billing setup. Free tier:
2,500 searches, no card required.

**Status:** confirmed working end-to-end, in active use.

**Degrades to:** the photo strip just doesn't render; the existing
"View property photos →" Drive link (when the source data has one) still
shows regardless.

---

## App-internal secrets (not third-party services)

These aren't external accounts — they're this app's own config — but
still belong in `.env.local` / your host's environment settings, never
committed:

- **`SALES_LOGIN_PASSWORD`** — the single shared password sales reps use
  to log in (`server/routes/auth.ts`). Change it before going live with
  something better than a placeholder.
- **`SESSION_SECRET`** — signs the login session cookie. The server
  **refuses to start in production** if this isn't set (`server/index.ts`)
  — deliberate, so a real deployment can't silently run on the insecure
  dev-only default.
- **`PORT`** — which port the Express API server listens on. Defaults to
  `4000`. The Vite dev server proxies `/api` to it; in production this
  same process also serves the built frontend.

---

## Evaluated but not used

For context, in case these come up again: **Google Places API** and
**Google Drive API** were both investigated (for richer property data and
for pulling the source sheet's Drive photo folders directly) and
confirmed via direct testing to be blocked/disabled on this Cloud
project, with the Drive folder itself also appearing to require sign-in.
Neither is wired into any code — no env var, no route. If real access to
either is ever enabled, that's a separate follow-up, not something this
doc's checklist depends on.
