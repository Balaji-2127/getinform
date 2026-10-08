import { useEffect, useState } from "react";
import { computeInsights, type Insights } from "./insightsData";
import "./CampaignsPage.css";
import "./InsightsPage.css";

type SavedArea = { cityId: string; locality: string };

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  // Which localities are already starred ("My Areas") — a plain Set of
  // "cityId::locality" keys, loaded once so each row's star can render
  // filled/empty immediately instead of flashing unstarred first.
  const [saved, setSaved] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    computeInsights().then((result) => {
      if (!cancelled) setData(result);
    });
    fetch("/api/saved-areas")
      .then((r) => (r.ok ? (r.json() as Promise<SavedArea[]>) : []))
      .then((areas) => {
        if (!cancelled) setSaved(new Set(areas.map((a) => `${a.cityId}::${a.locality}`)));
      })
      .catch(() => {
        if (!cancelled) setSaved(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSaved = (cityId: string, locality: string) => {
    const key = `${cityId}::${locality}`;
    const isSaved = saved?.has(key) ?? false;
    setSaved((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(key);
      else next.add(key);
      return next;
    });
    fetch("/api/saved-areas", {
      method: isSaved ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cityId, locality }),
    }).catch(() => {});
  };

  const maxCityScreens = data ? Math.max(...data.cities.map((c) => c.screens), 1) : 1;
  const maxLocality = data ? Math.max(...data.topLocalities.map((r) => r.value), 1) : 1;
  const maxSize = data ? Math.max(...data.screenSizes.map((r) => r.value), 1) : 1;

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">MARKET INSIGHTS</span>
          <h1>Market Insights</h1>
          <p>A real-time view of Adonmo's own inventory — where the reach and screen density actually is, across all cities.</p>
        </div>
      </div>

      {!data && (
        <div className="cpg-empty">
          <p>Crunching inventory numbers…</p>
        </div>
      )}

      {data && (
        <>
          <div className="cpg-stats-row">
            <StatCard icon="🏢" label="Total Properties" sub="Across all cities" value={data.totals.properties.toLocaleString()} color="indigo" />
            <StatCard icon="🖥️" label="Total Screens" sub="Active DOOH screens" value={data.totals.screens.toLocaleString()} color="green" />
            <StatCard icon="🏠" label="Household Reach" sub="Potential households/mo" value={data.totals.households.toLocaleString()} color="orange" />
            <StatCard icon="₹" label="Ad Budget (Mo)" sub="Est. full-inventory value" value={`₹${data.totals.budget.toLocaleString()}`} color="blue" />
          </div>

          <div className="insights-grid">
            <Panel title="Screens by city">
              {data.cities
                .slice()
                .sort((a, b) => b.screens - a.screens)
                .map((c) => (
                  <BarRow key={c.cityId} label={c.label} value={c.screens} max={maxCityScreens} sub={`${c.properties.toLocaleString()} properties`} />
                ))}
            </Panel>

            <Panel title="Top localities by screen count">
              {data.topLocalities.length === 0 ? (
                <p className="insights-empty">No locality data available.</p>
              ) : (
                data.topLocalities.map((r) => (
                  <BarRow
                    key={r.label}
                    label={r.label}
                    value={r.value}
                    max={maxLocality}
                    starred={saved?.has(`${r.cityId}::${r.locality}`) ?? false}
                    onToggleStar={() => toggleSaved(r.cityId, r.locality)}
                  />
                ))
              )}
            </Panel>

            <Panel title="Screen size mix">
              {data.screenSizes.length === 0 ? (
                <p className="insights-empty">No screen size data available.</p>
              ) : (
                data.screenSizes.map((r) => <BarRow key={r.label} label={r.label} value={r.value} max={maxSize} color="orange" />)
              )}
            </Panel>
          </div>
        </>
      )}
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="insights-panel">
      <h2>{title}</h2>
      <div className="insights-bars">{children}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  sub,
  color = "indigo",
  starred,
  onToggleStar,
}: {
  label: string;
  value: number;
  max: number;
  sub?: string;
  color?: "indigo" | "orange";
  // Only the locality panel passes these — "My Areas" starring. Omitted
  // entirely for the city/screen-size panels, which aren't locality rows.
  starred?: boolean;
  onToggleStar?: () => void;
}) {
  const pct = Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="insights-bar-row">
      <div className="insights-bar-label">
        <span className="insights-bar-label-text">
          {onToggleStar && (
            <button
              type="button"
              className={"insights-star-btn" + (starred ? " is-starred" : "")}
              onClick={onToggleStar}
              title={starred ? "Remove from My Areas" : "Save to My Areas"}
              aria-pressed={starred}
            >
              {starred ? "★" : "☆"}
            </button>
          )}
          <span>{label}</span>
        </span>
        <span className="insights-bar-value">
          {value.toLocaleString()}
          {sub ? <span className="insights-bar-sub"> · {sub}</span> : null}
        </span>
      </div>
      <div className="insights-bar-track">
        <div className={`insights-bar-fill insights-bar-${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
