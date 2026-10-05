import type { ScreenFeatureCollection } from "../data/cities";

// This module used to build a supercluster index for both maps
// (GoogleInventoryMap and DashboardMap) — neither clusters anymore (every
// property draws as its own individual pin now, never bundled behind a
// cluster bubble), so only the shared feature type remains. Kept as its
// own module/name rather than inlined into data/cities.ts so the four
// files that still import ProjectFeature from here don't all need
// updating for what's otherwise a pure type move.
export type ProjectFeature = ScreenFeatureCollection["features"][number];
