import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One level up from server/ (both in source, run via tsx, and once compiled
// to dist-server/) is the project root, where src/data/screens/ lives — the
// same per-city JSON files the frontend already loads, read directly here
// rather than duplicated.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = path.join(__dirname, "..", "src", "data", "screens");

export const SUPPORTED_CITIES = [
  "bengaluru",
  "hyderabad",
  "mumbai",
  "ncr",
  "ahmedabad",
  "bhuvaneshwar",
  "chennai",
  "coimbatore",
  "indore",
  "jaipur",
  "kochi",
  "kolkata",
  "lucknow",
  "pune",
  "tirupati",
  "chandigarh",
  "kanpur",
  "nellore",
  "surat",
  "vijaywada",
  "vishakapatnam",
] as const;
export type CityId = (typeof SUPPORTED_CITIES)[number];

export type ScreenFeature = {
  geometry: { coordinates: [number, number] };
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
};
type ScreenFeatureCollection = { features: ScreenFeature[] };

function loadCityFeaturesFromDisk(cityId: CityId): ScreenFeature[] {
  const raw = fs.readFileSync(path.join(SCREENS_DIR, `${cityId}.json`), "utf-8");
  return (JSON.parse(raw) as ScreenFeatureCollection).features;
}

const featureCache = new Map<CityId, ScreenFeature[]>();

// Every property in a city, cached after first read since these files
// don't change while the server is running. Used by search (across every
// city) and by the campaign PDF export (full property details for a
// specific campaign's own shortlisted ids).
export function getCityFeatures(cityId: CityId): ScreenFeature[] {
  let features = featureCache.get(cityId);
  if (!features) {
    features = loadCityFeaturesFromDisk(cityId);
    featureCache.set(cityId, features);
  }
  return features;
}

const idCache = new Map<CityId, Set<string>>();

// Master inventory IDs for a city, cached after first read since these files
// don't change while the server is running.
export function getKnownMediaSiteIds(cityId: CityId): Set<string> {
  let ids = idCache.get(cityId);
  if (!ids) {
    ids = new Set(getCityFeatures(cityId).map((f) => f.properties.mediaSiteId).filter((id): id is string => Boolean(id)));
    idCache.set(cityId, ids);
  }
  return ids;
}
