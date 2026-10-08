# getinform (Adonmo)

A sales tool for planning and sharing DOOH (digital out-of-home) ad campaigns across
residential properties in 21 Indian cities. A rep uploads a client's shortlisted properties
as an Excel sheet; the app matches it against real inventory data, generates a shareable,
no-login client-facing map link with those properties highlighted, and tracks the whole
campaign history in a sales dashboard.

The app has two completely separate surfaces:

- **The sales dashboard** (`/`, password-gated) — campaign upload, inventory browsing,
  client history, market insights, reports, and a shareable-link generator.
- **The client-facing map** (`/campaign/:id`, no login) — a bare link safe to send directly
  to a client, showing only their own shortlisted properties highlighted on a 3D map, with a
  guided tour, campaign stats, and (if resolvable) their own logo.

## How it works

### Dashboard (`src/dashboard/`)

A sidebar-nav shell (`Dashboard.tsx`, collapsible) with:

- **Dashboard** (`DashboardHome.tsx`) — stat cards, recent campaigns, quick actions, top clients.
- **Campaigns** (`CampaignsPage.tsx`) — upload a shortlist, or open a past campaign; embeds the
  same highlighted map the client link uses, plus a fullscreen toggle, an edit-shortlist action,
  and a "copy client link" button.
- **Inventory** (`DashboardMap.tsx` / `PropertyDetailPanel.tsx`) — browse every property across
  every city with no campaign context, same 3D map engine.
- **Clients** (`ClientsPage.tsx`) — campaign history grouped by client name.
- **Market Insights** (`InsightsPage.tsx`) — real aggregates (totals, screens-by-city,
  top localities, screen-size mix) computed from the same inventory data, not fabricated.
- **Reports** (`ReportsPage.tsx`) — sortable/searchable table of every campaign, CSV export.
- **My Areas / Shortlists / Recent Searches** — star a locality from Insights to track it
  live; see which properties get independently shortlisted across multiple campaigns; a log
  of search results reps have actually clicked.
- **AI Assistant** — still a placeholder; needs a scoping decision (what it should actually do)
  before it's worth building.
- Global search (`GlobalSearch.tsx`) in the topbar, backed by `server/routes/search.ts`.

### Campaign upload & share flow

1. A rep uploads one `.xlsx` workbook with a sheet per city (`server/sheetMapping.ts` maps
   exact sheet names like `Property List - Hyderabad` to a city).
2. `server/routes/campaigns.ts` matches each row's `Media Site Id` column against that city's
   known inventory (`server/inventoryLookup.ts`) and stores the matched selections
   (`server/db.ts`, Firestore).
3. The upload returns a shareable `/campaign/:id` link immediately — also always re-copyable
   later from the Campaigns page header.
4. A campaign can be edited (add/remove properties without re-uploading).

### The map (`src/GoogleInventoryMap.tsx`)

Google's `maps3d` (`Map3DElement`) photorealistic 3D tiles. Every property is its own
individual pin — there is no clustering. A property's own screens are drawn lazily, only once
it's actually selected, since a city can have 1,000+ properties but only ever a handful
selected at once. A campaign's own shortlisted properties are the exception: always shown with
full screen detail immediately, and always rendered as individual pins regardless of zoom.

Color convention (consistent everywhere, resting or selected): **blue = targeted for this
client's campaign**, **green = Adonmo's general inventory**. A guided "tour the shortlist"
mode flies through a campaign's properties one at a time.

`src/MapboxInventoryMap.tsx` and friends existed as a parallel experimental map engine and have
since been fully removed — Google's 3D map is the only one now.

### Property photos & client logos

Real property photos aren't in the source data (the sheet's own Google Drive photo links
require sign-in). `server/routes/propertyImages.ts` instead runs a Google Images search via
[Serper.dev](https://serper.dev) on `"<property name>, <locality>"` and shows the results as a
thumbnail strip in the property panel. `server/routes/branding.ts` resolves a client's own logo
by asking Gemini for their website domain, then using Google's public favicon service — shown
next to their campaign. Both degrade silently (no thumbnails / an initials badge) if unconfigured.

### PDF export

`src/dashboard/campaignPdf.ts` generates a real one-pager (client/campaign name, stats, full
property table) client-side via `jsPDF`. Lazy-loaded so its ~600KB of dependencies (plus
`html2canvas`) only load for someone who actually clicks "Download PDF" — the main bundle is
unaffected.

## Data

Per-city inventory lives in `src/data/screens/*.json` — one GeoJSON-like `FeatureCollection`
per city, lazily code-split (`src/data/cities.ts`) so switching cities doesn't pull every
city's data into the initial bundle. 21 cities are covered: Bengaluru, Hyderabad, Mumbai, NCR
(Delhi/Gurgaon/Noida merged — existing campaigns reference it as one city), Ahmedabad,
Bhuvaneshwar, Chennai, Chandigarh, Coimbatore, Indore, Jaipur, Kanpur, Kochi, Kolkata, Lucknow,
Nellore, Pune, Surat, Tirupati, Vijaywada, and Vishakapatnam.

Each property has a `mediaSiteId`, `name`, `locality`/`zone`, `screens` (a count, not
individually surveyed positions — `src/syntheticScreens.ts` generates illustrative per-screen
markers arranged around the building), `households`, `impressionsPerMonth`, `monthlyAdBudget`,
`screenSize`, and an optional Drive `visualLink`.

## Tech stack

- **React 19** + **TypeScript** + **Vite 8** (frontend)
- **Express 5** + **Firebase Admin SDK (Firestore)** + **cookie-session** (backend API, `server/`)
- **Google Maps Platform** — `maps3d` (`Map3DElement`), loaded via Google's official dynamic
  bootstrap (`src/google/loadGoogleMaps.ts`)
- **ExcelJS** — parses uploaded campaign shortlist workbooks
- **jsPDF** — client-side campaign one-pager export
- **Serper.dev** + **Gemini API** — property photos and client logo resolution (see below)

Every external service, what it's for, whether it's required, and where to get a key is
documented in **[`PRODUCTION_SERVICES.md`](./PRODUCTION_SERVICES.md)** — read that before
deploying.

## Getting started

### Prerequisites

- Node.js 18+
- A [Google Maps Platform](https://console.cloud.google.com/google/maps-apis/credentials) API
  key with a Cloud Billing account attached (required — the map won't load without it)

### Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` — see `.env.example`'s own comments and `PRODUCTION_SERVICES.md` for what
each variable does and whether it's required. At minimum you need
`VITE_GOOGLE_MAPS_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SALES_LOGIN_PASSWORD`, and
`SESSION_SECRET` — the server won't start without the Firebase one.

### Scripts

```bash
npm run dev       # Vite dev server + API server together (concurrently)
npm run build     # type-check both client and server, then build for production
npm run start     # run the built server (serves the built frontend too) — production only
npm run preview   # preview the production client build locally
npm run lint      # oxlint
```

### Deployment

This app has a real, long-running backend (Express) — it does **not** run on a static-only
host like Vercel's default preset. See **"Hosting"** in
[`PRODUCTION_SERVICES.md`](./PRODUCTION_SERVICES.md) for the full explanation and a
Render/Railway setup walkthrough. Campaign data lives in Firestore rather than a local file,
so (unlike an earlier version of this app) no persistent disk is required on whichever host
you pick.

## Project structure

```
src/
├── App.tsx                  # routes "/campaign/:id" (client link) vs. everything else (sales tool)
├── LoginGate.tsx             # password gate for the sales tool
├── ClientCampaignView.tsx    # the no-login client-facing map page
├── MapExperience.tsx         # shared wrapper: map + city switcher + campaign banner
├── GoogleInventoryMap.tsx    # the 3D map itself (pins, highlighting, tour, legend, inspector)
├── CampaignBanner.tsx        # campaign name/stats/tour controls (floats on the client link,
│                              # portals into the dashboard's own header when embedded there)
├── InspectorPanel.tsx        # property/screen detail panel, incl. photo strip
├── MapLegend.tsx              # inventory show/hide toggle + color legend
├── syntheticScreens.ts       # derives illustrative per-screen markers from a project's total
├── google/
│   ├── loadGoogleMaps.ts     # Google Maps JS API dynamic-library bootstrap
│   └── cameraMath.ts         # bbox → Map3DElement camera conversion
├── data/
│   ├── cities.ts             # city list + lazy per-city data loaders (21 cities)
│   └── screens/*.json        # per-city inventory datasets
└── dashboard/                 # the sales dashboard shell + every nav page (see "How it works")

server/
├── index.ts                  # Express app, sessions, static serving in production
├── db.ts                      # Firestore — campaigns, searchHistory, savedAreas
├── inventoryLookup.ts         # known Media Site Ids per city, for upload matching
├── sheetMapping.ts            # upload sheet name → city id
└── routes/
    ├── auth.ts                # login/logout/session
    ├── campaigns.ts           # upload, get, edit-selections
    ├── search.ts               # dashboard global search
    ├── branding.ts             # client logo resolution (Gemini + favicon)
    ├── propertyImages.ts       # property photo search (Serper.dev)
    ├── savedAreas.ts           # "My Areas"
    └── shortlists.ts           # cross-campaign popular-shortlist aggregate
```
