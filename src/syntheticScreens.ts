import type { ScreenFeatureCollection } from "./data/cities";

export type ProjectFeature = ScreenFeatureCollection["features"][number];

// A single illustrative screen marker generated around a project's
// coordinate. The underlying dataset only tracks a `screens` COUNT per
// project — it has no per-screen id, position, or status. Everything here
// is derived (an even split of the project's totals) or a synthetic
// placeholder position, and is labeled as such wherever it reaches the UI.
//
// If/when real per-screen records (id, lat/long, status, ...) become
// available, swap `generateSyntheticScreens` for a function that reads them
// directly — nothing else in the map/panel code needs to change, since both
// consume the same `SyntheticScreen` shape.
export type SyntheticScreen = {
  id: string;
  index: number;
  longitude: number;
  latitude: number;
  screenSize: string | null;
  estImpressionsPerMonth: number | null;
  estAdBudgetPerMonth: number | null;
};

const VISUAL_SCREEN_CAP = 24;
// Kept close to the project building's own footprint (see
// PROJECT_FOOTPRINT_HALF_SIDE_METERS in InventoryMap.tsx, ~9m half-side) so
// screens read as "on/around this building", not floating nearby.
const RING_RADIUS_METERS = 12;
const METERS_PER_DEGREE_LAT = 110_540;

function metersPerDegreeLng(latitude: number): number {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

export function generateSyntheticScreens(project: ProjectFeature): {
  screens: SyntheticScreen[];
  hiddenCount: number;
} {
  const p = project.properties;
  const total = p.screens ?? 0;
  const visibleCount = Math.min(total, VISUAL_SCREEN_CAP);
  const [lng, lat] = project.geometry.coordinates;

  const sizes = (p.screenSize ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const perScreenImpressions =
    total > 0 && p.impressionsPerMonth != null ? Math.round(p.impressionsPerMonth / total) : null;
  const perScreenBudget = total > 0 && p.monthlyAdBudget != null ? Math.round(p.monthlyAdBudget / total) : null;

  const lngPerMeter = 1 / metersPerDegreeLng(lat);
  const latPerMeter = 1 / METERS_PER_DEGREE_LAT;

  const screens: SyntheticScreen[] = [];
  for (let i = 0; i < visibleCount; i++) {
    const angle = (i / Math.max(visibleCount, 1)) * Math.PI * 2;
    screens.push({
      id: `${p.mediaSiteId ?? "SITE"}-S${String(i + 1).padStart(2, "0")}`,
      index: i + 1,
      longitude: lng + Math.cos(angle) * RING_RADIUS_METERS * lngPerMeter,
      latitude: lat + Math.sin(angle) * RING_RADIUS_METERS * latPerMeter,
      screenSize: sizes.length > 0 ? sizes[i % sizes.length] : null,
      estImpressionsPerMonth: perScreenImpressions,
      estAdBudgetPerMonth: perScreenBudget,
    });
  }

  return { screens, hiddenCount: Math.max(0, total - visibleCount) };
}

export function screensToFeatureCollection(screens: SyntheticScreen[]) {
  return {
    type: "FeatureCollection" as const,
    features: screens.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
      properties: { screenId: s.id },
    })),
  };
}
