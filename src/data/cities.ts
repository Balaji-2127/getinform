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

export type CityId =
  | "bengaluru"
  | "hyderabad"
  | "mumbai"
  | "ncr"
  | "ahmedabad"
  | "bhuvaneshwar"
  | "chennai"
  | "coimbatore"
  | "indore"
  | "jaipur"
  | "kochi"
  | "kolkata"
  | "lucknow"
  | "pune"
  | "tirupati"
  | "chandigarh"
  | "kanpur"
  | "nellore"
  | "surat"
  | "vijaywada"
  | "vishakapatnam";

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
  // Centers below are each city's own inventory centroid (computed from
  // its real property coordinates when this city was added), not a
  // separately looked-up city-center — only used as a fallback framing if
  // the data ever loads with zero usable points.
  { id: "ahmedabad", label: "Ahmedabad", center: [72.5386, 23.0895], zoom: 10.5 },
  { id: "bhuvaneshwar", label: "Bhuvaneshwar", center: [85.8184, 20.3002], zoom: 10.5 },
  { id: "chennai", label: "Chennai", center: [80.1854, 12.9701], zoom: 10.5 },
  { id: "coimbatore", label: "Coimbatore", center: [76.9897, 11.04], zoom: 10.5 },
  { id: "indore", label: "Indore", center: [75.8812, 22.7424], zoom: 10.5 },
  { id: "jaipur", label: "Jaipur", center: [75.7683, 26.8524], zoom: 10.5 },
  { id: "kochi", label: "Kochi", center: [76.3364, 10.0017], zoom: 10.5 },
  { id: "kolkata", label: "Kolkata", center: [88.4058, 22.5692], zoom: 10.5 },
  { id: "lucknow", label: "Lucknow", center: [80.9937, 26.8452], zoom: 10.5 },
  { id: "pune", label: "Pune", center: [73.8192, 18.5678], zoom: 10.5 },
  { id: "tirupati", label: "Tirupati", center: [79.4338, 13.6328], zoom: 10.5 },
  { id: "chandigarh", label: "Chandigarh", center: [76.7796, 30.6721], zoom: 10.5 },
  { id: "kanpur", label: "Kanpur", center: [80.3078, 26.4799], zoom: 10.5 },
  { id: "nellore", label: "Nellore", center: [79.9849, 14.4353], zoom: 10.5 },
  { id: "surat", label: "Surat", center: [72.7843, 21.175], zoom: 10.5 },
  { id: "vijaywada", label: "Vijaywada", center: [80.6551, 16.5178], zoom: 10.5 },
  { id: "vishakapatnam", label: "Vishakapatnam", center: [83.2866, 17.7659], zoom: 10.5 },
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
  ahmedabad: () => import("./screens/ahmedabad.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  bhuvaneshwar: () => import("./screens/bhuvaneshwar.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  chennai: () => import("./screens/chennai.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  coimbatore: () => import("./screens/coimbatore.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  indore: () => import("./screens/indore.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  jaipur: () => import("./screens/jaipur.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  kochi: () => import("./screens/kochi.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  kolkata: () => import("./screens/kolkata.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  lucknow: () => import("./screens/lucknow.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  pune: () => import("./screens/pune.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  tirupati: () => import("./screens/tirupati.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  chandigarh: () => import("./screens/chandigarh.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  kanpur: () => import("./screens/kanpur.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  nellore: () => import("./screens/nellore.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  surat: () => import("./screens/surat.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  vijaywada: () => import("./screens/vijaywada.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
  vishakapatnam: () => import("./screens/vishakapatnam.json") as unknown as Promise<{ default: ScreenFeatureCollection }>,
};

export function loadCityScreens(id: CityId) {
  return LOADERS[id]().then((m) => m.default);
}
