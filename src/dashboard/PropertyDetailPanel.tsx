import { useMemo, useState } from "react";
import type { ProjectFeature } from "../google/clustering";
import { generateSyntheticScreens } from "../syntheticScreens";
import "./PropertyDetailPanel.css";

type Tab = "screens" | "details" | "nearby";

export default function PropertyDetailPanel({ feature, onBack }: { feature: ProjectFeature | null; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("screens");

  const screens = useMemo(() => (feature ? generateSyntheticScreens(feature).screens : []), [feature]);

  if (!feature) {
    return (
      <div className="pdp-panel pdp-empty">
        <p>Click a property on the map to see its details here.</p>
      </div>
    );
  }

  const p = feature.properties;
  const dailyFootfall = p.impressionsPerMonth != null ? Math.round(p.impressionsPerMonth / 30) : null;

  return (
    <div className="pdp-panel">
      <button type="button" className="pdp-back-all" onClick={onBack}>
        ← Back to all properties
      </button>

      <div className="pdp-photo">
        {p.visualLink ? (
          <a href={p.visualLink} target="_blank" rel="noreferrer" className="pdp-photo-link">
            View property photos →
          </a>
        ) : (
          <span className="pdp-photo-placeholder">No photos available</span>
        )}
      </div>

      <div className="pdp-header">
        <h2>{p.name ?? "Untitled property"}</h2>
        <span className="pdp-status">Active</span>
      </div>
      <p className="pdp-address">
        {p.locality ?? "—"}
        {p.zone ? ` · ${p.zone}` : ""}
      </p>

      <div className="pdp-stats">
        <Stat label="Screens" value={(p.screens ?? 0).toLocaleString()} />
        <Stat label="Households" value={(p.households ?? 0).toLocaleString()} />
        <Stat label="Impressions/mo" value={p.impressionsPerMonth != null ? p.impressionsPerMonth.toLocaleString() : "—"} />
        <Stat label="Est. daily footfall" value={dailyFootfall != null ? dailyFootfall.toLocaleString() : "—"} />
        <Stat label="Ad budget/mo" value={p.monthlyAdBudget != null ? `₹${p.monthlyAdBudget.toLocaleString()}` : "—"} wide />
        <Stat label="Screen size" value={p.screenSize ?? "—"} wide />
      </div>

      <div className="pdp-tabs">
        <button type="button" className={tab === "screens" ? "is-active" : ""} onClick={() => setTab("screens")}>
          Screens ({screens.length})
        </button>
        <button type="button" className={tab === "details" ? "is-active" : ""} onClick={() => setTab("details")}>
          Details
        </button>
        <button type="button" className={tab === "nearby" ? "is-active" : ""} onClick={() => setTab("nearby")}>
          Nearby Clients
        </button>
      </div>

      <div className="pdp-tab-body">
        {tab === "screens" && (
          <ul className="pdp-screen-list">
            {screens.map((s) => (
              <li key={s.id}>
                <span>{s.id}</span>
                <span className="pdp-screen-size">{s.screenSize ?? "—"}</span>
                <span className="pdp-screen-status">Active</span>
              </li>
            ))}
          </ul>
        )}
        {tab === "details" && (
          <dl className="pdp-detail-list">
            <dt>Property type</dt>
            <dd>{p.propertyType ?? "—"}</dd>
            <dt>Building age</dt>
            <dd>{p.buildingAge != null ? `${p.buildingAge} yrs` : "—"}</dd>
            <dt>Pin code</dt>
            <dd>{p.pinCode ?? "—"}</dd>
            <dt>Est. property price</dt>
            <dd>{p.priceCr != null ? `₹${p.priceCr} Cr` : "—"}</dd>
            <dt>Media Site ID</dt>
            <dd>{p.mediaSiteId ?? "—"}</dd>
          </dl>
        )}
        {tab === "nearby" && (
          <p className="pdp-coming-soon">Not yet implemented — nearby client locations aren't in our data yet.</p>
        )}
      </div>

      <div className="pdp-actions">
        <button type="button" className="pdp-add-btn" disabled title="Not yet implemented">
          + Add to Campaign
        </button>
        <button type="button" className="pdp-inventory-btn" disabled title="Not yet implemented">
          View in Inventory
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={"pdp-stat" + (wide ? " pdp-stat-wide" : "")}>
      <span className="pdp-stat-value">{value}</span>
      <span className="pdp-stat-label">{label}</span>
    </div>
  );
}
