import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFeature } from "../google/clustering";
import type { CityId } from "../data/cities";
import { generateSyntheticScreens } from "../syntheticScreens";
import { fetchCampaigns, type CampaignListItem } from "./campaignHistory";
import { useToast } from "./Toast";
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon } from "./icons";
import "./PropertyDetailPanel.css";

type Tab = "screens" | "details" | "nearby";

type NearbyClient = { campaignId: string; clientName: string; campaignName: string; thisProperty: boolean; sameLocality: number };

export default function PropertyDetailPanel({
  feature,
  cityId,
  onBack,
  onOpenCampaign,
}: {
  feature: ProjectFeature | null;
  // The panel only ever receives a feature, which carries no city of its
  // own — but adding it to a campaign and finding nearby clients both need
  // to know which city's inventory it belongs to.
  cityId: CityId;
  onBack: () => void;
  onOpenCampaign?: (campaignId: string) => void;
}) {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("screens");

  // ---- "Add to campaign" -----------------------------------------------
  // This button used to be permanently disabled, which left Inventory as a
  // place you could look at properties but never act on one. It now adds the
  // property to any existing campaign, through the same idempotent endpoint
  // the server uses to guard against duplicates.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    if (campaigns === null) fetchCampaigns().then(setCampaigns);
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPickerOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen, campaigns]);

  const addToCampaign = async (c: CampaignListItem) => {
    const mediaSiteId = feature?.properties.mediaSiteId;
    if (!mediaSiteId) return;
    setAdding(c.id);
    try {
      const res = await fetch(`/api/campaigns/${c.id}/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityId, mediaSiteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      showToast(data.added ? `Added to ${c.clientName} — ${c.campaignName}` : `Already in ${c.clientName} — ${c.campaignName}`);
      setPickerOpen(false);
      // Counts on the picker would otherwise be stale next time it opens.
      setCampaigns(null);
      setNearbyFor(null);
    } catch {
      showToast("Couldn't add it to that campaign — try again", "error");
    } finally {
      setAdding(null);
    }
  };

  // ---- "Nearby clients" --------------------------------------------------
  // Was a placeholder. Built from real campaign selections: who already has
  // this building, or others in the same locality, shortlisted.
  const [nearby, setNearby] = useState<{ locality: string | null; clients: NearbyClient[] } | null>(null);
  const [nearbyFor, setNearbyFor] = useState<string | null>(null);
  const siteKey = feature?.properties.mediaSiteId ? `${cityId}:${feature.properties.mediaSiteId}` : null;

  useEffect(() => {
    if (tab !== "nearby" || !siteKey || nearbyFor === siteKey) return;
    let cancelled = false;
    const [c, id] = siteKey.split(":");
    fetch(`/api/properties/nearby-clients?cityId=${encodeURIComponent(c)}&mediaSiteId=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : { locality: null, clients: [] }))
      .then((d) => {
        if (cancelled) return;
        setNearby(d);
        setNearbyFor(siteKey);
      })
      .catch(() => {
        if (cancelled) return;
        // Has to record which property this (empty) answer is for too, or
        // the derived loading state above would never clear on a failure.
        setNearby({ locality: null, clients: [] });
        setNearbyFor(siteKey);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, siteKey, nearbyFor]);

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
        <ArrowLeftIcon size={14} /> Back to all properties
      </button>

      <div className="pdp-photo">
        {p.visualLink ? (
          <a href={p.visualLink} target="_blank" rel="noreferrer" className="pdp-photo-link">
            View property photos <ArrowRightIcon size={13} />
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
          <div className="pdp-nearby">
            {/* Loading is derived rather than stored: the result is only
                current if it was fetched for the property now on screen.
                Clicking straight from one property to another would
                otherwise flash the previous building's clients. */}
            {nearby === null || nearbyFor !== siteKey ? (
              <p className="pdp-nearby-empty">Checking campaigns…</p>
            ) : nearby.clients.length === 0 ? (
              <p className="pdp-nearby-empty">
                No client has shortlisted this property{nearby.locality ? ` or anything else in ${nearby.locality}` : ""} yet.
              </p>
            ) : (
              <ul className="pdp-nearby-list">
                {nearby.clients.map((n) => (
                  <li key={n.campaignId}>
                    <button type="button" onClick={() => onOpenCampaign?.(n.campaignId)} disabled={!onOpenCampaign}>
                      <span className="pdp-nearby-name">
                        {n.clientName} <span className="pdp-nearby-campaign">· {n.campaignName}</span>
                      </span>
                      <span className="pdp-nearby-sub">
                        {n.thisProperty && <span className="pdp-nearby-tag">This property</span>}
                        {n.sameLocality > 0 &&
                          `${n.sameLocality} more in ${nearby.locality ?? "this locality"}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="pdp-actions" ref={pickerRef}>
        <button
          type="button"
          className="pdp-add-btn"
          onClick={() => setPickerOpen((o) => !o)}
          disabled={!p.mediaSiteId}
          aria-expanded={pickerOpen}
        >
          <PlusIcon size={13} /> Add to campaign
        </button>
        {pickerOpen && (
          <div className="pdp-picker" role="menu">
            <span className="pdp-picker-title">Add to which campaign?</span>
            {campaigns === null ? (
              <p className="pdp-picker-empty">Loading…</p>
            ) : campaigns.length === 0 ? (
              <p className="pdp-picker-empty">No campaigns yet — upload one first.</p>
            ) : (
              campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  className="pdp-picker-item"
                  disabled={adding !== null}
                  onClick={() => addToCampaign(c)}
                >
                  <span className="pdp-picker-name">{c.clientName}</span>
                  <span className="pdp-picker-sub">
                    {adding === c.id ? "Adding…" : `${c.campaignName} · ${Object.values(c.counts).reduce((n, v) => n + v, 0)} properties`}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
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
