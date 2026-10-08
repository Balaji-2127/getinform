import { CITIES, loadCityScreens, type CityId } from "../data/cities";

export type CityTotals = {
  cityId: CityId;
  label: string;
  properties: number;
  screens: number;
  households: number;
  budget: number;
};

export type RankedRow = { label: string; value: number };
// Carries the raw cityId/locality alongside the display label — needed
// so "My Areas" can save a locality by its real identity, not by
// re-parsing a formatted "Locality, City" string back apart.
export type LocalityRow = RankedRow & { cityId: CityId; locality: string };

export type Insights = {
  cities: CityTotals[];
  totals: { properties: number; screens: number; households: number; budget: number };
  topLocalities: LocalityRow[];
  screenSizes: RankedRow[];
};

// Everything here is a real aggregate computed from the same per-city
// inventory files InventoryPage/GoogleInventoryMap already use — no
// invented market-research numbers. "Insights" here means insights into
// our own DOOH inventory (where the density/reach/value actually is),
// which is what a rep can act on, not third-party industry data we don't
// have. Shared by InsightsPage and the Dashboard home page's stat row —
// loadCityScreens' dynamic imports are module-cached, so calling this from
// both places doesn't re-fetch the underlying city data twice.
export async function computeInsights(): Promise<Insights> {
  const perCity = await Promise.all(
    CITIES.map(async (city) => {
      const fc = await loadCityScreens(city.id);
      // Keyed by cityId::locality (not just locality) so the same
      // locality name in two different cities never collides.
      const localityTotals = new Map<string, { cityId: CityId; locality: string; value: number }>();
      const sizeTotals = new Map<string, number>();
      let screens = 0;
      let households = 0;
      let budget = 0;

      for (const f of fc.features) {
        const p = f.properties;
        screens += p.screens ?? 0;
        households += p.households ?? 0;
        budget += p.monthlyAdBudget ?? 0;

        if (p.locality) {
          const key = `${city.id}::${p.locality}`;
          const existing = localityTotals.get(key);
          localityTotals.set(key, { cityId: city.id, locality: p.locality, value: (existing?.value ?? 0) + (p.screens ?? 0) });
        }
        if (p.screenSize) {
          sizeTotals.set(p.screenSize, (sizeTotals.get(p.screenSize) ?? 0) + (p.screens ?? 0));
        }
      }

      return {
        totals: { cityId: city.id, label: city.label, properties: fc.features.length, screens, households, budget },
        localityTotals,
        sizeTotals,
      };
    }),
  );

  const totals = { properties: 0, screens: 0, households: 0, budget: 0 };
  const localityTotals = new Map<string, { cityId: CityId; locality: string; value: number }>();
  const sizeTotals = new Map<string, number>();

  for (const city of perCity) {
    totals.properties += city.totals.properties;
    totals.screens += city.totals.screens;
    totals.households += city.totals.households;
    totals.budget += city.totals.budget;
    for (const [k, v] of city.localityTotals) localityTotals.set(k, v);
    for (const [k, v] of city.sizeTotals) sizeTotals.set(k, (sizeTotals.get(k) ?? 0) + v);
  }

  const topLocalities: LocalityRow[] = [...localityTotals.values()]
    .map((row) => ({ label: `${row.locality}, ${CITIES.find((c) => c.id === row.cityId)?.label ?? row.cityId}`, value: row.value, cityId: row.cityId, locality: row.locality }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const screenSizes: RankedRow[] = [...sizeTotals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return {
    cities: perCity.map((c) => c.totals),
    totals,
    topLocalities,
    screenSizes,
  };
}
