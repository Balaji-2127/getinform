// Minimal local stand-in for GeoJSON.FeatureCollection — the ambient
// @types/geojson namespace isn't visible under this project's tsconfig
// (its `types` array is scoped to vite/client only).
export type ScreenFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      zone: string | null;
      locality: string | null;
      name: string | null;
      pinCode: string | number | null;
      priceCr: number | null;
      screenSize: string | null;
      visualLink: string | null;
      screens: number | null;
      households: number | null;
      impressionsPerMonth: number | null;
      monthlyAdBudget: number | null;
      mediaSiteId: string | null;
      buildingAge: number | null;
      propertyType: string | null;
    };
  }[];
};

export type CityId = "bengaluru" | "hyderabad" | "mumbai" | "ncr";

export type City = {
  id: CityId;
  label: string;
  // Fallback view if the data for some reason has no usable points.
  center: [number, number];
  zoom: number;
};

export const CITIES: City[] = [
  { id: "bengaluru", label: "Bengaluru", center: [77.5946, 12.9716], zoom: 10.5 },
  { id: "hyderabad", label: "Hyderabad", center: [78.4867, 17.385], zoom: 10.5 },
  { id: "mumbai", label: "Mumbai", center: [72.8777, 19.076], zoom: 10.5 },
  { id: "ncr", label: "NCR", center: [77.209, 28.6139], zoom: 9 },
];

// Lazy-loaded per city so switching cities doesn't pull all ~1.7MB of
// inventory data into the initial bundle at once.
// Cast at the boundary: resolveJsonModule infers widened string types for
// JSON literals (e.g. "type" as `string`, not the literal "FeatureCollection"),
// so the raw import type never structurally matches. The actual runtime
// shape is guaranteed by the conversion script that generated these files.
const LOADERS: Record<CityId, () => Promise<{ default: ScreenFeatureCollection }>> = {
  bengaluru: () => import("./screens/bengaluru.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  hyderabad: () => import("./screens/hyderabad.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  mumbai: () => import("./screens/mumbai.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  ncr: () => import("./screens/ncr.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
};

export function loadCityScreens(id: CityId) {
  return LOADERS[id]().then((m) => m.default);
}
