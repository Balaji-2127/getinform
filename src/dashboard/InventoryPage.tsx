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
export default function InventoryPage({
  focusProperty,
  onFocusHandled,
}: {
  // Set by the dashboard's global search when a rep picks a property
  // result from a city other than whatever's currently showing — switches
  // to it here, then DashboardMap itself picks up the same id to select
  // and fly to it once that city's loaded.
  focusProperty?: { cityId: CityId; mediaSiteId: string } | null;
  onFocusHandled?: () => void;
}) {
  const [cityId, setCityId] = useState<CityId>(focusProperty?.cityId ?? "hyderabad");
  const [selected, setSelected] = useState<ProjectFeature | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [totals, setTotals] = useState<{ properties: number; screens: number; households: number; budget: number } | null>(null);
  // A local copy of what to focus, independent of the parent's own
  // focusProperty lifecycle (which gets cleared via onFocusHandled right
  // after this fires) — DashboardMap reads this one, so it isn't affected
  // by exactly when the parent's clear-after-use update lands.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(focusProperty?.mediaSiteId ?? null);

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  // A new focus target switches to its city — harmless no-op re-set if
  // already there — and hands off to DashboardMap's own focusMediaSiteId
  // prop below to actually select it. onFocusHandled clears the parent's
  // state so revisiting this tab later doesn't re-trigger the same jump.
  useEffect(() => {
    if (!focusProperty) return;
    setCityId(focusProperty.cityId);
    setPendingFocusId(focusProperty.mediaSiteId);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProperty]);

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
          focusMediaSiteId={pendingFocusId}
        />
        <PropertyDetailPanel feature={selected} onBack={() => setSelected(null)} />
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
