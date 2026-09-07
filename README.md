# getinform

An interactive 3D map for exploring residential digital-screen ad inventory across Indian
cities. The app opens on a rotating photorealistic globe; picking a city flies the camera in
and hands off to a Google Photorealistic 3D Tiles map, where inventory is drilled down from
city → cluster → project → individual screen.

## How it works

- **Intro globe** (`src/GlobeIntro.tsx`) — a `three.js` / `@react-three/fiber` Earth (day
  texture, specular map, animated cloud layer, starfield) that the user zooms through when a
  city is picked from the sidebar.
- **City sidebar** (`src/CitySidebar.tsx`) — lets the user switch between the available cities
  at any time.
- **3D inventory map** (`src/GoogleInventoryMap.tsx`) — renders Google's `maps3d` /
  `Map3DElement` photorealistic tiles for the selected city and layers three views on top:
  1. **City view** — supercluster-based clustering (`src/google/clustering.ts`) of every
     project in the city.
  2. **Cluster / project view** — drilling into a cluster expands sub-clusters (or, once a
     cluster is small enough, straight to individual projects) using each cluster's own
     `getClusterExpansionZoom`.
  3. **Screen view** — because the source data only records a *count* of screens per project
     (not individual screen positions), `src/syntheticScreens.ts` generates illustrative
     per-screen markers arranged in a ring around the project's building footprint. These are
     clearly derived/placeholder positions, not surveyed screen locations.
- **Inspector panel** (`src/InspectorPanel.tsx`) — a breadcrumb-navigable side panel showing
  aggregate stats (screens, households, monthly impressions, ad budget, estimated daily
  footfall, top localities/zones) at the cluster level, and per-project / per-screen detail
  further down.
- **Camera math** (`src/google/cameraMath.ts`) — converts a bounding box of points into a
  `Map3DElement` camera (center, range, tilt, heading) for each of the above view levels.

## Data

Per-city inventory lives in `src/data/screens/*.json` (`bengaluru`, `hyderabad`, `mumbai`,
`ncr`) as GeoJSON-like `FeatureCollection`s — one `Point` feature per residential
project/site, with properties such as `zone`, `locality`, `name`, `screens`, `households`,
`impressionsPerMonth`, `monthlyAdBudget`, `screenSize`, `mediaSiteId`, `buildingAge`, and
`propertyType`. Each city file is lazily code-split (`src/data/cities.ts`) so switching
cities doesn't pull all cities' data into the initial bundle.

## Tech stack

- **React 19** + **TypeScript** + **Vite 8**
- **Google Maps Platform** — `maps3d` (`Map3DElement`) photorealistic 3D tiles, loaded via
  Google's official dynamic-import bootstrap (`src/google/loadGoogleMaps.ts`)
- **three.js** / **@react-three/fiber** / **@react-three/drei** — the intro globe
- **supercluster** — spatial clustering of inventory points
- **oxlint** — linting

> Note: `maplibre-gl`, `react-map-gl`, and `cesium` remain in `package.json` and a handful of
> earlier prototype components (`src/InventoryMap.tsx`, `src/Custom3DView.tsx`,
> `src/Google3DView.tsx`, `src/Map3D.tsx`, `src/OptionsPanel.tsx`, `src/Stage.tsx`) still exist
> in the repo but are **not** wired into the current app (`src/App.tsx` only renders
> `GoogleInventoryMap`, `GlobeIntro`, and `CitySidebar`). They're earlier iterations
> (MapLibre-based and Cesium-based maps) kept around for reference and can be removed once
> confirmed unneeded.

## Getting started

### Prerequisites

- Node.js 18+
- A [Google Maps Platform](https://console.cloud.google.com/google/maps-apis/credentials) API
  key with a Cloud Billing account attached (used for the photorealistic 3D map)

### Setup

```bash
npm install
cp .env.example .env.local
```

Then add your API key to `.env.local`:

```
VITE_GOOGLE_MAPS_API_KEY=your-key-here
```

Restrict the key to your own domain(s) (HTTP referrers) once you have one.

### Scripts

```bash
npm run dev       # start the Vite dev server
npm run build     # type-check (tsc -b) and build for production
npm run preview   # preview the production build locally
npm run lint      # run oxlint
```

## Project structure

```
src/
├── App.tsx                 # top-level phase machine: intro → zooming → map
├── GlobeIntro.tsx           # three.js rotating Earth intro
├── CitySidebar.tsx          # city picker
├── GoogleInventoryMap.tsx   # main 3D inventory map (city/cluster/project/screen views)
├── InspectorPanel.tsx       # breadcrumb detail panel
├── syntheticScreens.ts      # derives illustrative per-screen markers from project totals
├── google/
│   ├── loadGoogleMaps.ts    # Google Maps JS API dynamic-library bootstrap
│   ├── clustering.ts        # supercluster wrapper
│   └── cameraMath.ts        # bbox → Map3DElement camera conversion
├── data/
│   ├── cities.ts            # city list + lazy per-city data loaders
│   └── screens/*.json       # per-city inventory datasets
└── assets/                  # Earth textures for the intro globe
```
