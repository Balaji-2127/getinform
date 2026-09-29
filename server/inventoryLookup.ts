import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One level up from server/ (both in source, run via tsx, and once compiled
// to dist-server/) is the project root, where src/data/screens/ lives — the
// same per-city JSON files the frontend already loads, read directly here
// rather than duplicated.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = path.join(__dirname, "..", "src", "data", "screens");

export const SUPPORTED_CITIES = ["bengaluru", "hyderabad", "mumbai", "ncr"] as const;
export type CityId = (typeof SUPPORTED_CITIES)[number];

type ScreenFeature = { properties: { mediaSiteId: string | null } };
type ScreenFeatureCollection = { features: ScreenFeature[] };

function loadCityMediaSiteIds(cityId: CityId): Set<string> {
  const raw = fs.readFileSync(path.join(SCREENS_DIR, `${cityId}.json`), "utf-8");
  const fc = JSON.parse(raw) as ScreenFeatureCollection;
  const ids = new Set<string>();
  for (const f of fc.features) {
    if (f.properties.mediaSiteId) ids.add(f.properties.mediaSiteId);
  }
  return ids;
}

const cache = new Map<CityId, Set<string>>();

// Master inventory IDs for a city, cached after first read since these files
// don't change while the server is running.
export function getKnownMediaSiteIds(cityId: CityId): Set<string> {
  let ids = cache.get(cityId);
  if (!ids) {
    ids = loadCityMediaSiteIds(cityId);
    cache.set(cityId, ids);
  }
  return ids;
}
