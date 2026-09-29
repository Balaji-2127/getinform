import { useEffect, useState } from "react";
import ClientLogo from "./ClientLogo";
import { cityLabel, fetchCampaigns, groupByClient, type CampaignListItem } from "./campaignHistory";
import "./CampaignsPage.css";
import "./ClientsPage.css";

export default function ClientsPage({ onOpenCampaign }: { onOpenCampaign: (campaignId: string) => void }) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchCampaigns().then(setCampaigns);
  }, []);

  const groups = campaigns ? groupByClient(campaigns) : [];
  const filtered = query.trim()
    ? groups.filter((g) => g.clientName.toLowerCase().includes(query.trim().toLowerCase()))
    : groups;

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">CLIENTS</span>
          <h1>Clients</h1>
          <p>Every client with at least one uploaded campaign, built from your campaign history.</p>
        </div>
      </div>

      {campaigns === null && (
        <div className="cpg-empty">
          <p>Loading clients…</p>
        </div>
      )}

      {campaigns !== null && groups.length === 0 && (
        <div className="cpg-empty">
          <p>No campaigns uploaded yet — clients will show up here once you upload one.</p>
        </div>
      )}

      {campaigns !== null && groups.length > 0 && (
        <>
          <input
            type="text"
            className="clients-search"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {filtered.length === 0 ? (
            <div className="cpg-empty">
              <p>No clients match "{query}".</p>
            </div>
          ) : (
            <div className="clients-grid">
              {filtered.map((g) => (
                <div key={g.clientName} className="clients-card">
                  <ClientLogo clientName={g.clientName} />
                  <p className="clients-sub">
                    {g.campaigns.length} {g.campaigns.length === 1 ? "campaign" : "campaigns"}
                    {g.cities.length > 0 ? ` · ${g.cities.map(cityLabel).join(", ")}` : ""}
                  </p>
                  <div className="clients-stat-row">
                    <div className="clients-stat">
                      <span className="clients-stat-value">{g.totalProperties.toLocaleString()}</span>
                      <span className="clients-stat-label">Properties shortlisted</span>
                    </div>
                    <div className="clients-stat">
                      <span className="clients-stat-value">{g.cities.length}</span>
                      <span className="clients-stat-label">{g.cities.length === 1 ? "City" : "Cities"} covered</span>
                    </div>
                  </div>
                  <ul className="clients-campaign-list">
                    {g.campaigns.map((c) => (
                      <li key={c.id}>
                        <div>
                          <span className="clients-campaign-name">{c.campaignName}</span>
                          <span className="clients-campaign-date">{new Date(c.createdAt).toLocaleDateString()}</span>
                        </div>
                        <button type="button" onClick={() => onOpenCampaign(c.id)}>
                          Open →
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
