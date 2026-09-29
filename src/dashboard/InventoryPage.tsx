import { useEffect, useState } from "react";
import DashboardMap from "./DashboardMap";
import PropertyDetailPanel from "./PropertyDetailPanel";
import { CITIES, loadCityScreens, type CityId } from "../data/cities";
import type { ProjectFeature } from "../google/clustering";
import "./CampaignsPage.css";

// The generic "browse everything, no campaign context" map — this used to
// be what the Campaigns page showed by default, but Campaigns is meant to
// show a specific uploaded campaign's results, not the whole inventory. It
// lives here instead, where "just exploring what we have" actually belongs.
export default function InventoryPage() {
  const [cityId, setCityId] = useState<CityId>("hyderabad");
  const [selected, setSelected] = useState<ProjectFeature | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [totals, setTotals] = useState<{ properties: number; screens: number; households: number; budget: number } | null>(null);

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  useEffect(() => {
    let cancelled = false;
    setTotals(null);
    setSelected(null);
    loadCityScreens(cityId).then((fc) => {
      if (cancelled) return;
      let screens = 0;
      let households = 0;
      let budget = 0;
      for (const f of fc.features) {
        screens += f.properties.screens ?? 0;
        households += f.properties.households ?? 0;
        budget += f.properties.monthlyAdBudget ?? 0;
      }
      setTotals({ properties: fc.features.length, screens, households, budget });
    });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">INVENTORY</span>
          <h1>Browse Adonmo's Full Inventory</h1>
          <p>Every property in {cityLabel} — not tied to any specific campaign.</p>
        </div>
      </div>

      <div className="cpg-stats-row">
        <StatCard icon="🏢" label="Properties" sub="Screen locations available" value={totals ? totals.properties.toLocaleString() : "…"} color="indigo" />
        <StatCard icon="🖥️" label="Screens" sub="Active screens in area" value={totals ? totals.screens.toLocaleString() : "…"} color="green" />
        <StatCard icon="🏠" label="Households" sub="Potential reach" value={totals ? totals.households.toLocaleString() : "…"} color="orange" />
        <StatCard icon="₹" label="Ad Budget (Mo)" sub="Estimated monthly budget" value={totals ? `₹${totals.budget.toLocaleString()}` : "…"} color="blue" />
      </div>

      <div className="cpg-body">
        <DashboardMap
          cityId={cityId}
          onCityChange={setCityId}
          selectedMediaSiteId={selected?.properties.mediaSiteId ?? null}
          onSelectProject={setSelected}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />
        <PropertyDetailPanel feature={selected} />
      </div>
    </div>
  );
}

function StatCard({ icon, label, sub, value, color }: { icon: string; label: string; sub: string; value: string; color: "indigo" | "green" | "orange" | "blue" }) {
  return (
    <div className={`cpg-stat-card cpg-stat-${color}`}>
      <span className="cpg-stat-icon">{icon}</span>
      <div>
        <span className="cpg-stat-value">{value}</span>
        <span className="cpg-stat-label">{label}</span>
        <span className="cpg-stat-sub">{sub}</span>
      </div>
    </div>
  );
}
