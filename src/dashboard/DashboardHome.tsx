import { useEffect, useState } from "react";
import { cityLabel, fetchCampaigns, groupByClient, type CampaignListItem } from "./campaignHistory";
import { computeInsights, type Insights } from "./insightsData";
import StatCard from "./StatCard";
import { ArrowRightIcon, BuildingIcon, CampaignsIcon, ChevronRightIcon, ClientsIcon, InventoryIcon, ScreenIcon, UploadIcon } from "./icons";
import "./CampaignsPage.css";
import "./DashboardHome.css";

type Section = "dashboard" | "campaigns" | "inventory" | "clients" | "reports" | "upload";

// The landing page, kept deliberately plain: four headline numbers, the
// latest campaigns, and the three things a rep actually comes here to do.
// Every figure is the same real data the other tabs show — campaign
// history and the inventory files — never a separate estimate.
export default function DashboardHome({
  onNavigate,
  onOpenCampaign,
}: {
  onNavigate: (section: Section) => void;
  onOpenCampaign: (campaignId: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);

  useEffect(() => {
    fetchCampaigns().then(setCampaigns);
    computeInsights().then(setInsights);
  }, []);

  const clientCount = campaigns ? groupByClient(campaigns).length : 0;
  const recentCampaigns = campaigns ? campaigns.slice(0, 5) : [];

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">OVERVIEW</span>
          <h1>Welcome back</h1>
          <p>Your campaigns and inventory at a glance.</p>
        </div>
      </div>

      <div className="cpg-stats-row">
        <StatCard icon={<CampaignsIcon />} label="Campaigns" sub="Uploaded so far" value={campaigns && campaigns.length.toLocaleString()} tone="indigo" />
        <StatCard icon={<ClientsIcon />} label="Clients" sub="Distinct clients served" value={campaigns && clientCount.toLocaleString()} tone="green" />
        <StatCard icon={<BuildingIcon />} label="Total Properties" sub="Across all inventory" value={insights && insights.totals.properties.toLocaleString()} tone="orange" />
        <StatCard icon={<ScreenIcon />} label="Total Screens" sub="Across all inventory" value={insights && insights.totals.screens.toLocaleString()} tone="blue" />
      </div>

      <div className="dash-home-grid">
        <div className="dash-home-panel dash-home-panel-wide">
          <div className="dash-home-panel-head">
            <h2>Recent campaigns</h2>
            <button type="button" className="dash-home-link btn btn-link btn-sm" onClick={() => onNavigate("reports")}>
              View all <ArrowRightIcon size={13} />
            </button>
          </div>

          {campaigns === null && (
            <ul className="dash-home-campaign-list">
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i}>
                  <div className="dash-home-skel-text">
                    <span className="dash-home-skel-name skel" />
                    <span className="dash-home-skel-meta skel" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {campaigns !== null && campaigns.length === 0 && (
            <div className="dash-home-cta">
              <p>No campaigns uploaded yet — upload your first shortlist to see it here.</p>
              <button type="button" className="cpg-empty-btn btn btn-primary" onClick={() => onNavigate("upload")}>
                <UploadIcon size={15} /> Upload a shortlist sheet
              </button>
            </div>
          )}
          {recentCampaigns.length > 0 && (
            <ul className="dash-home-campaign-list">
              {recentCampaigns.map((c) => {
                const cities = Object.entries(c.counts)
                  .filter(([, count]) => count > 0)
                  .map(([city]) => cityLabel(city));
                return (
                  <li key={c.id}>
                    <div>
                      <span className="dash-home-campaign-name">
                        {c.clientName} <span className="dash-home-campaign-sep">·</span> {c.campaignName}
                      </span>
                      <span className="dash-home-campaign-meta">
                        {new Date(c.createdAt).toLocaleDateString()}
                        {cities.length > 0 ? ` · ${cities.join(", ")}` : ""}
                      </span>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenCampaign(c.id)}>
                      Open <ArrowRightIcon size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="dash-home-panel">
          <div className="dash-home-panel-head">
            <h2>Quick actions</h2>
          </div>
          <div className="dash-home-actions">
            <button type="button" className="dash-home-action" onClick={() => onNavigate("upload")}>
              <span className="dash-home-action-icon"><UploadIcon size={17} /></span>
              <span>
                <strong>Upload a shortlist</strong>
                <small>Turn a shortlist into a shareable map</small>
              </span>
              <span className="dash-home-action-chev" aria-hidden="true"><ChevronRightIcon size={15} /></span>
            </button>
            <button type="button" className="dash-home-action" onClick={() => onNavigate("inventory")}>
              <span className="dash-home-action-icon"><InventoryIcon size={17} /></span>
              <span>
                <strong>Browse inventory</strong>
                <small>Explore every property, no campaign needed</small>
              </span>
              <span className="dash-home-action-chev" aria-hidden="true"><ChevronRightIcon size={15} /></span>
            </button>
            <button type="button" className="dash-home-action" onClick={() => onNavigate("clients")}>
              <span className="dash-home-action-icon"><ClientsIcon size={17} /></span>
              <span>
                <strong>View clients</strong>
                <small>Everyone you've run a campaign for</small>
              </span>
              <span className="dash-home-action-chev" aria-hidden="true"><ChevronRightIcon size={15} /></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
