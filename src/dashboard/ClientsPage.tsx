import { useEffect, useState } from "react";
import ClientLogo from "./ClientLogo";
import { ArrowRightIcon, TrashIcon } from "./icons";
import DeleteCampaignDialog, { type DeletableCampaign } from "./DeleteCampaignDialog";
import { cityLabel, fetchCampaigns, groupByClient, type CampaignListItem } from "./campaignHistory";
import "./CampaignsPage.css";
import "./ClientsPage.css";

export default function ClientsPage({
  onOpenCampaign,
  onCampaignDeleted,
}: {
  onOpenCampaign: (campaignId: string) => void;
  // Same reason Reports has it: if the deleted campaign is the one the
  // Campaigns tab is holding open, the shell has to let go of it.
  onCampaignDeleted?: (campaignId: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DeletableCampaign | null>(null);

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
            <div className="clients-grid stagger">
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
                        <div className="clients-campaign-actions">
                          <button type="button" onClick={() => onOpenCampaign(c.id)}>
                            Open <ArrowRightIcon size={13} />
                          </button>
                          <button
                            type="button"
                            className="clients-delete-btn"
                            title={`Delete "${g.clientName} — ${c.campaignName}"`}
                            aria-label={`Delete campaign ${g.clientName} — ${c.campaignName}`}
                            onClick={() =>
                              setPendingDelete({
                                id: c.id,
                                clientName: g.clientName,
                                campaignName: c.campaignName,
                                properties: Object.values(c.counts).reduce((n, v) => n + v, 0),
                              })
                            }
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {pendingDelete && (
        <DeleteCampaignDialog
          campaign={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onDeleted={(id) => {
            // Dropping the campaign re-derives the groups, so a client whose
            // last campaign just went disappears from this page by itself.
            setCampaigns((prev) => prev?.filter((c) => c.id !== id) ?? null);
            onCampaignDeleted?.(id);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
