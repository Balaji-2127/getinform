import { useEffect, useState } from "react";
import { computeInsights, type Insights } from "./insightsData";
import StatCard from "./StatCard";
import { BuildingIcon, HouseholdIcon, RupeeIcon, ScreenIcon, StarIcon } from "./icons";
import { useToast } from "./Toast";
import "./CampaignsPage.css";
import "./InsightsPage.css";

type SavedArea = { cityId: string; locality: string };

export default function InsightsPage() {
  const showToast = useToast();
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
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        showToast(isSaved ? "Removed from My Areas" : "Added to My Areas");
      })
      .catch(() => {
        // Revert the optimistic update — the save didn't actually happen.
        setSaved((prev) => {
          const next = new Set(prev);
          if (isSaved) next.add(key);
          else next.delete(key);
          return next;
        });
        showToast("Couldn't save — try again", "error");
      });
  };

  const maxCityScreens = data ? Math.max(...data.cities.map((c) => c.screens), 1) : 1;
  const maxLocality = data ? Math.max(...data.topLocalities.map((r) => r.value), 1) : 1;
  const maxSize = data ? Math.max(...data.screenSizes.map((r) => r.value), 1) : 1;
  // A bar's length only says "bigger than that one". The share of the whole
  // estate is what actually answers "is this city worth pitching?", so every
  // row carries it.
  const totalScreens = data?.totals.screens ?? 0;
  const rankedCities = data ? [...data.cities].sort((a, b) => b.screens - a.screens) : [];

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">MARKET INSIGHTS</span>
          <h1>Market Insights</h1>
          <p>A real-time view of Adonmo's own inventory — where the reach and screen density actually is, across all cities.</p>
        </div>
      </div>

      <div className="cpg-stats-row">
        <StatCard icon={<BuildingIcon />} label="Total Properties" sub="Across all cities" value={data && data.totals.properties.toLocaleString()} tone="indigo" />
        <StatCard icon={<ScreenIcon />} label="Total Screens" sub="Active DOOH screens" value={data && data.totals.screens.toLocaleString()} tone="green" />
        <StatCard icon={<HouseholdIcon />} label="Household Reach" sub="Potential households/mo" value={data && data.totals.households.toLocaleString()} tone="orange" />
        <StatCard icon={<RupeeIcon />} label="Ad Budget (Mo)" sub="Est. full-inventory value" value={data && `₹${data.totals.budget.toLocaleString()}`} tone="blue" />
      </div>

      {!data && (
        <div className="insights-grid">
          <Panel title="Screens by city">
            <BarSkeleton rows={6} />
          </Panel>
          <Panel title="Top localities by screen count">
            <BarSkeleton rows={6} />
          </Panel>
          <Panel title="Screen size mix">
            <BarSkeleton rows={4} />
          </Panel>
        </div>
      )}

      {data && (
        <>
          <div className="insights-grid">
            <Panel
              title="Screens by city"
              note={`${rankedCities.length} cities, ranked by screens`}
              className="insights-panel-cities"
            >
              {rankedCities.map((c, i) => (
                <BarRow
                  key={c.cityId}
                  rank={i + 1}
                  label={c.label}
                  value={c.screens}
                  max={maxCityScreens}
                  share={totalScreens > 0 ? c.screens / totalScreens : 0}
                  sub={`${c.properties.toLocaleString()} properties · ${
                    c.properties > 0 ? (c.screens / c.properties).toFixed(1) : "0"
                  } screens each`}
                />
              ))}
            </Panel>

            <div className="insights-side">
              <Panel title="Top localities by screen count" note="Star one to track it in My Areas">
                {data.topLocalities.length === 0 ? (
                  <p className="insights-empty">No locality data available.</p>
                ) : (
                  data.topLocalities.map((r) => (
                    <BarRow
                      key={r.label}
                      label={r.label}
                      value={r.value}
                      max={maxLocality}
                      share={totalScreens > 0 ? r.value / totalScreens : 0}
                      starred={saved?.has(`${r.cityId}::${r.locality}`) ?? false}
                      onToggleStar={() => toggleSaved(r.cityId, r.locality)}
                    />
                  ))
                )}
              </Panel>

              <Panel title="Screen size mix" note="Share of all screens by size">
                {data.screenSizes.length === 0 ? (
                  <p className="insights-empty">No screen size data available.</p>
                ) : (
                  data.screenSizes.map((r) => (
                    <BarRow
                      key={r.label}
                      label={r.label}
                      value={r.value}
                      max={maxSize}
                      share={totalScreens > 0 ? r.value / totalScreens : 0}
                      color="orange"
                    />
                  ))
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// Mirrors BarRow's own two-line shape (label line, then track) so the
// layout doesn't jump when the real bars replace these.
function BarSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="insights-bar-skel-row">
          <span className="insights-bar-skel-label skel" />
          <span className="insights-bar-skel-track skel" />
        </div>
      ))}
    </>
  );
}

function Panel({
  title,
  note,
  className,
  children,
}: {
  title: string;
  // One line saying what the panel actually measures. Without it the reader
  // has to infer it from the bars, and "screens" vs "properties" are easy to
  // confuse at a glance.
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"insights-panel" + (className ? ` ${className}` : "")}>
      <div className="insights-panel-head">
        <h2>{title}</h2>
        {note && <span className="insights-panel-note">{note}</span>}
      </div>
      <div className="insights-bars">{children}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  sub,
  share,
  rank,
  color = "indigo",
  starred,
  onToggleStar,
}: {
  label: string;
  value: number;
  max: number;
  sub?: string;
  // Fraction of all screens this row represents, rendered as a percentage.
  share?: number;
  rank?: number;
  color?: "indigo" | "orange";
  // Only the locality panel passes these - "My Areas" starring.
  starred?: boolean;
  onToggleStar?: () => void;
}) {
  // Floored so the smallest cities still render a visible sliver rather than
  // a bar that reads as zero when they genuinely have inventory.
  const pct = Math.max(2, Math.round((value / max) * 100));
  const sharePct = share !== undefined ? share * 100 : null;

  return (
    <div className="insights-bar-row">
      <div className="insights-bar-label">
        <span className="insights-bar-label-text">
          {rank !== undefined && <span className="insights-rank">{rank}</span>}
          {onToggleStar && (
            <button
              type="button"
              className={"insights-star-btn" + (starred ? " is-starred" : "")}
              onClick={onToggleStar}
              title={starred ? "Remove from My Areas" : "Save to My Areas"}
              aria-pressed={starred}
            >
              <StarIcon size={15} filled={starred} />
            </button>
          )}
          <span className="insights-bar-name">{label}</span>
        </span>
        <span className="insights-bar-value">
          {value.toLocaleString()}
          {sharePct !== null && (
            <span className="insights-bar-share">{sharePct < 0.1 ? "<0.1%" : `${sharePct.toFixed(1)}%`}</span>
          )}
        </span>
      </div>
      <div className="insights-bar-track">
        <div className={`insights-bar-fill insights-bar-${color}`} style={{ width: `${pct}%` }} />
      </div>
      {sub && <span className="insights-bar-sub">{sub}</span>}
    </div>
  );
}
