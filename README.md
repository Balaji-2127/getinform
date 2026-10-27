# getinform (Adonmo)

A sales tool for planning and sharing DOOH (digital out-of-home) ad campaigns across
residential properties in 21 Indian cities. A rep uploads a client's shortlisted properties
as an Excel sheet; the app matches it against real inventory data, generates a shareable,
no-login client map link with those properties highlighted, tracks whether the client opened
it, and keeps the campaign history in a sales dashboard.

Live at **https://adonmo.live** (Vercel).

The app has two completely separate surfaces:

- **The sales dashboard** (`/`, sign-in required) — campaign upload and editing, inventory
  browsing, clients, reports, team management, help.
- **The client map** (`/campaign/:id`, no login) — a link safe to send to a client, showing
  only their shortlisted properties on a 3D map, with a guided tour, campaign totals, their
  logo, and a lobby photo of their ad playing on an Adonmo screen.

## Sign-in and access control

There are two roles:

| Role | Sees | Can do |
| --- | --- | --- |
| **Admin** | Every campaign | Everything, plus the **Team** page (approve people, change roles, reset passwords, remove access) and reassigning campaign owners in Reports |
| **Sales** | Only campaigns they own | Upload, edit, share and download their own campaigns; browse inventory |

The server enforces this on every route, not just in the UI — a salesperson gets a 404 for
someone else's campaign, even when calling the API directly. Client links stay public.

**How someone gets in (email + password):**

1. A new person enters their work email and the **team password** (`SALES_LOGIN_PASSWORD`).
   That records an access request, shown on the admin's Team page with a badge in the sidebar.
2. An admin approves (or declines) it. Admins can also add someone in advance.
3. On their next sign-in the person must **choose their own password** before anything else
   opens. From then on only that password works for their email — the team password no longer
   opens their account.
4. Anyone can change their password from the avatar menu; an admin can reset a forgotten one
   from the Team page. Setting, changing or resetting a password signs out the person's other
   sessions, and removing someone ends their access on their next request.

Emails listed in `ADMIN_EMAILS` are always admins (that's how the first admin gets in).
Passwords are stored as salted scrypt hashes (`server/routes/auth.ts`); users live in the
`users` Firestore collection.

**Sign in with Google** is also built in: set `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`
(an OAuth "Web application" client from Google Cloud) and the login page shows the Google
button, using the same approval rules. Removing `SALES_LOGIN_PASSWORD` then turns the email +
password method off. The login page asks the server which methods are on
(`GET /api/auth/methods`).

Every campaign records its **owner** (whoever uploaded it). Campaigns from before sign-in
existed are **Unassigned** — visible only to admins until one picks an owner in Reports.

## How it works

### Dashboard (`src/dashboard/`)

A collapsible sidebar shell (`Dashboard.tsx`) grouped into Workspace / Admin / Support:

- **Dashboard** (`DashboardHome.tsx`) — four headline numbers, recent campaigns, quick actions.
- **Campaign Map** (`CampaignsPage.tsx`) — the campaign you've opened, on the same 3D map the
  client sees, with Edit shortlist, Update sheet, Download PDF, Copy client link and fullscreen.
  With no campaign open it shows the upload form instead (`src/UploadCampaign.tsx`).
- **Inventory** (`InventoryPage.tsx`, `DashboardMap.tsx`, `PropertyDetailPanel.tsx`) — every
  property in every city on a near-full-height map; the property panel shows society photos,
  numbers, screens, which clients already have it, and "Add to campaign".
- **Clients** (`ClientsPage.tsx`) — campaigns grouped by client.
- **Reports** (`ReportsPage.tsx`) — sortable, searchable table of campaigns with client opens
  and time on map, CSV export, delete; admins also get an Owner column and filter.
- **Team** (`TeamPage.tsx`, admins only) — requests, members, roles, password resets.
- **Help & FAQs** (`HelpPage.tsx`) — the narrated walkthrough video (`DemoPlayer.tsx`) and FAQ.
- Global search in the top bar (`GlobalSearch.tsx`, `server/routes/search.ts`), limited to the
  campaigns you're allowed to see.

### Campaign upload and share flow

1. A rep uploads one `.xlsx` workbook (max 4 MB — Vercel's request limit) with a sheet per city;
   `server/sheetMapping.ts` maps sheet names such as `Property List - Hyderabad` to a city.
2. `server/routes/campaigns.ts` matches each row's `Media Site Id` against that city's inventory
   (`server/inventoryLookup.ts`) and stores the matches in Firestore (`server/db.ts`), owned by
   the uploader.
3. The rep gets a `/campaign/:id` link, re-copyable any time from the Campaign Map page.
4. The campaign can later be edited (add/remove properties), grown with **Update sheet** (add to
   it, or replace it), or added to from Inventory. The link never changes.

### Client link (`src/ClientCampaignView.tsx`)

- Read-only map of the client's shortlist with totals (properties, screens, households,
  estimated impressions per month, monthly budget) and a guided tour.
- A lobby photo with the client's own ad playing on an Adonmo screen
  (`src/AdonmoScreenScene.tsx`, photo `public/lobby-screen.jpg`), hidden on small screens.
- Re-reads the campaign every 10 seconds while open, so edits made by the team appear on the
  client's screen without a new link or reload.
- Tracking: each open by someone not signed in counts as a view, and visible time on the map is
  reported every 30 seconds (`sendBeacon`). Both show in Reports; the team's own visits and the
  10-second refreshes are not counted.

### The map (`src/GoogleInventoryMap.tsx`)

Google's `maps3d` (`Map3DElement`) photorealistic 3D tiles, one pin per property (no
clustering). **Blue = this client's shortlist, green = the rest of Adonmo's inventory.** The
map loads Google's alpha channel and auto-dismisses its "alpha" banner
(`src/google/loadGoogleMaps.ts`).

### Property photos and client logos

The sheet's own Drive photo links need sign-in, so `server/routes/propertyImages.ts` runs a
Google Images search through [Serper.dev](https://serper.dev) on `"<name>, <locality>"`; the
results appear as a thumbnail strip in both property panels. `server/routes/branding.ts`
resolves a client's logo by asking Gemini for their domain and using Google's favicon service
(`/api/client-logo-image` serves the bytes for the PDF). Both fail quietly (no strip / initials).

### PDF export (`src/dashboard/campaignPdf.ts`)

A branded proposal built in the browser with jsPDF: Adonmo logo on one side and the client's
on the other, headline numbers, a link to the interactive map, and one table per city **sorted
by property value (highest first)** with a total row and page footers. Each city can also get a
static map of its pins (`/api/campaigns/:id/map-snapshot.png`), which needs the **Maps Static
API** enabled on the Google Cloud project — without it the PDF simply leaves the map out.
Lazy-loaded, so jsPDF never weighs down the main bundle.

## Data

Per-city inventory lives in `src/data/screens/*.json` — one GeoJSON-style FeatureCollection per
city, code-split (`src/data/cities.ts`). 21 cities: Bengaluru, Hyderabad, Mumbai, NCR
(Delhi/Gurgaon/Noida as one city), Ahmedabad, Bhuvaneshwar, Chennai, Chandigarh, Coimbatore,
Indore, Jaipur, Kanpur, Kochi, Kolkata, Lucknow, Nellore, Pune, Surat, Tirupati, Vijaywada,
and Vishakapatnam.

Each property has a `mediaSiteId`, `name`, `locality`/`zone`, `screens`, `households`,
`impressionsPerMonth`, `monthlyAdBudget`, `priceCr` (property value in crore), `buildingAge`,
`screenSize`, and an optional Drive `visualLink`. Screen counts are totals, not surveyed
positions — `src/syntheticScreens.ts` derives illustrative per-screen entries.

A few properties appear more than once under the same `mediaSiteId` (79 rows in total, mostly
NCR and Bengaluru, sometimes with different budgets). The app counts each id once, using the
first row; the source files still need correcting.

Firestore collections: `campaigns` (client, campaign name, selections, owner, view counts) and
`users` (email, role, status, password hash, last sign-in).

## Tech stack

- **React 19** + **TypeScript** + **Vite** (frontend)
- **Express 5** + **Firebase Admin SDK (Firestore)** + **cookie-session** (API, `server/`)
- **Google Maps Platform** — `maps3d`, plus Maps Static for PDF map snapshots
- **google-auth-library** — verifies Google sign-in tokens
- **ExcelJS** — parses uploaded workbooks
- **jsPDF** — client-side PDF proposals
- **Serper.dev** + **Gemini API** — property photos and client logos

Every external service, what it's for, whether it's required and where to get a key is in
**[`PRODUCTION_SERVICES.md`](./PRODUCTION_SERVICES.md)**.

## Getting started

### Prerequisites

- Node.js 18+
- A [Google Maps Platform](https://console.cloud.google.com/google/maps-apis/credentials) key
  with billing enabled (the map won't load without it)
- A Firebase project with Firestore, and a service-account JSON for it

### Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` (see the comments in `.env.example` and `PRODUCTION_SERVICES.md`):

| Variable | Needed for |
| --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | The map (required) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | The database (required — the server won't start without it) |
| `SESSION_SECRET` | Signing session cookies (required in production) |
| `SALES_LOGIN_PASSWORD` | Email + team password sign-in |
| `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` | Sign in with Google (optional) |
| `ADMIN_EMAILS` | Comma-separated emails that are always admins |
| `GEMINI_API_KEY`, `GEMINI_FLASH_MODEL` | Client logos (optional) |
| `SERPER_API_KEY` | Property photos (optional) |

Production refuses to start unless at least one sign-in method (`SALES_LOGIN_PASSWORD` or
`GOOGLE_CLIENT_ID`) is set.

**Local test sign-in.** To try the roles on your laptop without passwords or Google, start the
dev server with `AUTH_DEV_LOGIN=1 VITE_AUTH_DEV_LOGIN=1` (and `ADMIN_EMAILS=you@company.com`):
the login page then shows a "Local testing only" email box. The server never registers this
route in production or on Vercel, whatever the settings say.

### Scripts

```bash
npm run dev       # Vite dev server + API server together
npm run build     # type-check client and server, then build both
npm run start     # run the built server (serves the built frontend) — production only
npm run preview   # preview the production client build
npm run lint      # oxlint
```

### Deployment

Hosted on **Vercel**, project `getinform`, domain **adonmo.live** (www redirects to it).
Pushing `main` to GitHub deploys production automatically.

- The frontend is the static `dist/` build; the API runs as one serverless function,
  `api/index.js`, which wraps the Express app in `server/app.ts` (`server/index.ts` only adds
  `listen()` for local runs).
- `vercel.json` pins the function to Mumbai (`bom1`, next to Firestore in `asia-south1`),
  bundles the inventory files with it, and routes `/api/*` to it and everything else to the SPA.
- Environment variables are set in the Vercel project settings (Production), never committed.

## Walkthrough video

`public/demo.mp4` (about 2:40) is a real, narrated screen recording of the app, built by the
scripts in `video/` — see **[`video/README.md`](./video/README.md)**. Recording signs in with the
local test sign-in, so start the dev server with `AUTH_DEV_LOGIN=1 VITE_AUTH_DEV_LOGIN=1` and
`ADMIN_EMAILS`, then run `RECORD_AS=<an approved email> node video/record.mjs` followed by
`node video/mux.mjs`. Close heavy apps first — low memory makes the capture choppy and can stop
the 3D map loading.

## Project structure

```
api/
└── index.js                  # Vercel serverless entry -> dist-server/app.js

src/
├── App.tsx                   # "/campaign/:id" (client link) vs. the sales tool; session check
├── auth.ts                   # signed-in user type + context
├── LoginGate.tsx             # sign-in page (email + password, Google, local test)
├── SetPasswordPage.tsx       # "choose your own password" after first sign-in
├── UploadCampaign.tsx        # upload form + past campaigns
├── ClientCampaignView.tsx    # the client map page (live refresh, view tracking)
├── AdonmoScreenScene.tsx     # lobby photo with the client's ad on screen
├── MapExperience.tsx         # map + city switcher + campaign banner
├── GoogleInventoryMap.tsx    # the 3D map (pins, highlighting, tour, legend, inspector)
├── CampaignBanner.tsx        # campaign name, totals, tour controls
├── InspectorPanel.tsx        # property panel on the campaign map, incl. photos
├── MapLegend.tsx             # inventory toggle + colour legend
├── CitySidebar.tsx           # city list on the client map
├── uploadLimit.ts            # 4 MB upload cap shared by the upload forms
├── google/                   # Maps loader, camera maths
├── data/                     # city list + per-city inventory JSON
└── dashboard/                # dashboard shell and pages (see "Dashboard"), PDF, modals,
                              # Team page, change-password dialog, walkthrough player

server/
├── app.ts                    # Express app: sessions, sign-in check on every request, routes
├── index.ts                  # listen() for local / long-running hosting
├── env.ts                    # loads .env.local (re-read on change in dev)
├── db.ts                     # Firestore: campaigns (with owners and views), users
├── inventoryLookup.ts        # known Media Site Ids per city
├── sheetMapping.ts           # upload sheet name -> city
└── routes/
    ├── auth.ts               # sign-in (password, Google, local test), own passwords, access checks
    ├── team.ts               # Team page API (admins only)
    ├── campaigns.ts          # upload, edit, re-upload, owner, views, PDF map snapshot
    ├── search.ts             # top-bar search
    ├── shortlists.ts         # "nearby clients" for a property
    ├── branding.ts           # client logos
    └── propertyImages.ts     # property photos

video/                        # walkthrough recording and narration tooling
```
