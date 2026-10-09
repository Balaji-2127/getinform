import { useEffect, useState } from "react";
import { CITIES, loadCityScreens } from "../data/cities";
import { useToast } from "./Toast";
import "./CampaignsPage.css";
import "./MyAreasPage.css";

type SavedArea = { cityId: string; locality: string };
type AreaStats = SavedArea & { cityLabel: string; properties: number; screens: number; households: number; budget: number };

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

// Real localities a rep starred from Market Insights (see the ☆ button
// on its "Top localities" panel) — stats recomputed live from the same
// per-city inventory data every other page uses, not a frozen snapshot
// taken at save time.
export default function MyAreasPage() {
  const showToast = useToast();
  const [areas, setAreas] = useState<SavedArea[] | null>(null);
  const [stats, setStats] = useState<AreaStats[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/saved-areas")
      .then((r) => (r.ok ? (r.json() as Promise<SavedArea[]>) : []))
      .then((data) => {
        if (!cancelled) setAreas(data);
      })
      .catch(() => {
        if (!cancelled) setAreas([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!areas) return;
    let cancelled = false;
    (async () => {
      const byCity = new Map<string, SavedArea[]>();
      for (const a of areas) {
        const list = byCity.get(a.cityId);
        if (list) list.push(a);
        else byCity.set(a.cityId, [a]);
      }
      const results: AreaStats[] = [];
      for (const [cityId, cityAreas] of byCity) {
        const fc = await loadCityScreens(cityId as Parameters<typeof loadCityScreens>[0]);
        for (const area of cityAreas) {
          let properties = 0;
          let screens = 0;
          let households = 0;
          let budget = 0;
          for (const f of fc.features) {
            if (f.properties.locality !== area.locality) continue;
            properties++;
            screens += f.properties.screens ?? 0;
            households += f.properties.households ?? 0;
            budget += f.properties.monthlyAdBudget ?? 0;
          }
          results.push({ ...area, cityLabel: cityLabel(cityId), properties, screens, households, budget });
        }
      }
      if (!cancelled) setStats(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [areas]);

  const removeArea = (area: SavedArea) => {
    const previousAreas = areas;
    const previousStats = stats;
    setAreas((prev) => prev?.filter((a) => !(a.cityId === area.cityId && a.locality === area.locality)) ?? null);
    setStats((prev) => prev?.filter((a) => !(a.cityId === area.cityId && a.locality === area.locality)) ?? null);
    fetch("/api/saved-areas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(area),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        showToast("Removed from My Areas");
      })
      .catch(() => {
        setAreas(previousAreas);
        setStats(previousStats);
        showToast("Couldn't remove — try again", "error");
      });
  };

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">SAVED</span>
          <h1>My Areas</h1>
          <p>Localities you've starred from Market Insights — stats here update live, not a snapshot from when you saved them.</p>
        </div>
      </div>

      {areas === null && (
        <div className="cpg-empty">
          <p>Loading…</p>
        </div>
      )}

      {areas !== null && areas.length === 0 && (
        <div className="cpg-empty">
          <p>No areas saved yet — open Market Insights and click the ☆ next to any locality in "Top localities by screen count".</p>
        </div>
      )}

      {areas !== null && areas.length > 0 && stats === null && (
        <div className="cpg-empty">
          <p>Loading area stats…</p>
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="mya-grid">
          {stats.map((a) => (
            <div key={`${a.cityId}-${a.locality}`} className="mya-card">
              <div className="mya-card-head">
                <div>
                  <span className="mya-card-title">{a.locality}</span>
                  <span className="mya-card-sub">{a.cityLabel}</span>
                </div>
                <button type="button" className="mya-remove-btn" onClick={() => removeArea(a)} title="Remove from My Areas">
                  ★
                </button>
              </div>
              <div className="mya-stats">
                <div className="mya-stat">
                  <span className="mya-stat-value">{a.properties.toLocaleString()}</span>
                  <span className="mya-stat-label">Properties</span>
                </div>
                <div className="mya-stat">
                  <span className="mya-stat-value">{a.screens.toLocaleString()}</span>
                  <span className="mya-stat-label">Screens</span>
                </div>
                <div className="mya-stat">
                  <span className="mya-stat-value">{a.households.toLocaleString()}</span>
                  <span className="mya-stat-label">Households</span>
                </div>
                <div className="mya-stat">
                  <span className="mya-stat-value">₹{a.budget.toLocaleString()}</span>
                  <span className="mya-stat-label">Ad budget/mo</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
