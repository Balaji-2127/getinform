import { useEffect, useState } from "react";
import { cityLabel, fetchCampaigns, groupByClient, type CampaignListItem } from "./campaignHistory";
import { computeInsights, type Insights } from "./insightsData";
import ClientLogo from "./ClientLogo";
import "./CampaignsPage.css";
import "./DashboardHome.css";

type Section = "dashboard" | "campaigns" | "inventory" | "clients" | "insights" | "upload";

// The landing page — a genuinely useful at-a-glance summary built from the
// exact same real data every other tab already uses (campaign history +
// inventory aggregates), not a fresh mock. No numbers appear here that
// aren't also visible somewhere else in the app.
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

  const clientGroups = campaigns ? groupByClient(campaigns) : [];
  const recentCampaigns = campaigns ? campaigns.slice(0, 5) : [];
  const topClients = clientGroups.slice(0, 3);

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">OVERVIEW</span>
          <h1>Welcome back</h1>
          <p>Here's what's happening across your campaigns and inventory right now.</p>
        </div>
      </div>

      <div className="cpg-stats-row">
        <StatCard icon="📢" label="Campaigns" sub="Uploaded so far" value={campaigns ? campaigns.length.toLocaleString() : "…"} color="indigo" />
        <StatCard icon="🤝" label="Clients" sub="Distinct clients served" value={campaigns ? clientGroups.length.toLocaleString() : "…"} color="green" />
        <StatCard icon="🏢" label="Total Properties" sub="Across all inventory" value={insights ? insights.totals.properties.toLocaleString() : "…"} color="orange" />
        <StatCard icon="🖥️" label="Total Screens" sub="Across all inventory" value={insights ? insights.totals.screens.toLocaleString() : "…"} color="blue" />
      </div>

      <div className="dash-home-grid">
        <div className="dash-home-panel dash-home-panel-wide">
          <div className="dash-home-panel-head">
            <h2>Recent campaigns</h2>
            <button type="button" className="dash-home-link" onClick={() => onNavigate("campaigns")}>
              View all →
            </button>
          </div>

          {campaigns === null && <p className="dash-home-empty">Loading…</p>}
          {campaigns !== null && campaigns.length === 0 && (
            <div className="dash-home-cta">
              <p>No campaigns uploaded yet — upload your first shortlist to see it here.</p>
              <button type="button" className="cpg-empty-btn" onClick={() => onNavigate("upload")}>
                Upload a campaign sheet
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
                    <button type="button" onClick={() => onOpenCampaign(c.id)}>
                      Open →
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
              <span className="dash-home-action-icon">📤</span>
              <span>
                <strong>Upload a campaign</strong>
                <small>Turn a shortlist into a shareable map</small>
              </span>
            </button>
            <button type="button" className="dash-home-action" onClick={() => onNavigate("inventory")}>
              <span className="dash-home-action-icon">🗺️</span>
              <span>
                <strong>Browse inventory</strong>
                <small>Explore every property, no campaign needed</small>
              </span>
            </button>
            <button type="button" className="dash-home-action" onClick={() => onNavigate("insights")}>
              <span className="dash-home-action-icon">📊</span>
              <span>
                <strong>Market insights</strong>
                <small>See where reach and density are highest</small>
              </span>
            </button>
            <button type="button" className="dash-home-action" onClick={() => onNavigate("clients")}>
              <span className="dash-home-action-icon">🤝</span>
              <span>
                <strong>View clients</strong>
                <small>Everyone you've run a campaign for</small>
              </span>
            </button>
          </div>
        </div>

        {topClients.length > 0 && (
          <div className="dash-home-panel">
            <div className="dash-home-panel-head">
              <h2>Top clients</h2>
              <button type="button" className="dash-home-link" onClick={() => onNavigate("clients")}>
                View all →
              </button>
            </div>
            <ul className="dash-home-top-clients">
              {topClients.map((g) => (
                <li key={g.clientName}>
                  <ClientLogo clientName={g.clientName} />
                  <span className="dash-home-top-client-stat">
                    {g.totalProperties.toLocaleString()} properties · {g.campaigns.length}{" "}
                    {g.campaigns.length === 1 ? "campaign" : "campaigns"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
