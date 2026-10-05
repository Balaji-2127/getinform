import { useEffect, useMemo, useState } from "react";
import { cityLabel, fetchCampaigns, groupByClient, type CampaignListItem } from "./campaignHistory";
import "./CampaignsPage.css";
import "./ReportsPage.css";

type SortKey = "date" | "properties" | "client";

// A full, exportable listing of every campaign — built from the same
// GET /api/campaigns data Dashboard/Clients already use, just shown as a
// complete sortable table instead of a "recent 5" or a client-grouped
// view. No invented revenue/performance numbers (this app has no ad-spend
// or delivery tracking) — only what's actually known: who, what, when,
// where, and how many properties.
export default function ReportsPage({ onOpenCampaign }: { onOpenCampaign: (campaignId: string) => void }) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");

  useEffect(() => {
    fetchCampaigns().then(setCampaigns);
  }, []);

  const rows = useMemo(() => {
    if (!campaigns) return [];
    const withTotals = campaigns.map((c) => {
      const cities = Object.entries(c.counts)
        .filter(([, count]) => count > 0)
        .map(([city]) => cityLabel(city));
      const properties = Object.values(c.counts).reduce((sum, n) => sum + n, 0);
      return { ...c, cities, properties };
    });

    const filtered = query.trim()
      ? withTotals.filter(
          (c) =>
            c.clientName.toLowerCase().includes(query.trim().toLowerCase()) ||
            c.campaignName.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : withTotals;

    return filtered.sort((a, b) => {
      if (sortKey === "properties") return b.properties - a.properties;
      if (sortKey === "client") return a.clientName.localeCompare(b.clientName);
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }, [campaigns, query, sortKey]);

  const totalClients = campaigns ? groupByClient(campaigns).length : 0;
  const totalProperties = rows.reduce((sum, r) => sum + r.properties, 0);

  const exportCsv = () => {
    const header = ["Client", "Campaign", "Date", "Cities", "Properties shortlisted"];
    const lines = rows.map((r) =>
      [r.clientName, r.campaignName, new Date(r.createdAt).toLocaleDateString(), r.cities.join(" / "), String(r.properties)]
        .map((cell) => `"${cell.replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">REPORTS</span>
          <h1>Campaign Reports</h1>
          <p>Every campaign you've run, in one place — sortable, searchable, and exportable.</p>
        </div>
      </div>

      {campaigns === null && (
        <div className="cpg-empty">
          <p>Loading report…</p>
        </div>
      )}

      {campaigns !== null && campaigns.length === 0 && (
        <div className="cpg-empty">
          <p>No campaigns uploaded yet — your report will fill in once you do.</p>
        </div>
      )}

      {campaigns !== null && campaigns.length > 0 && (
        <>
          <div className="cpg-stats-row">
            <StatCard icon="📢" label="Total Campaigns" value={campaigns.length.toLocaleString()} color="indigo" />
            <StatCard icon="🤝" label="Clients Served" value={totalClients.toLocaleString()} color="green" />
            <StatCard icon="🏢" label="Properties Shortlisted" value={totalProperties.toLocaleString()} color="orange" />
          </div>

          <div className="reports-toolbar">
            <input
              type="text"
              className="reports-search"
              placeholder="Search by client or campaign…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="reports-toolbar-right">
              <label className="reports-sort-label">
                Sort by
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  <option value="date">Newest first</option>
                  <option value="properties">Most properties</option>
                  <option value="client">Client name</option>
                </select>
              </label>
              <button type="button" className="reports-export-btn" onClick={exportCsv}>
                ⬇ Export CSV
              </button>
            </div>
          </div>

          <div className="reports-table-wrap">
            {rows.length === 0 ? (
              <p className="reports-empty">No campaigns match "{query}".</p>
            ) : (
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Campaign</th>
                    <th>Date</th>
                    <th>Cities</th>
                    <th>Properties</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="reports-cell-strong">{r.clientName}</td>
                      <td>{r.campaignName}</td>
                      <td className="reports-cell-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="reports-cell-muted">{r.cities.join(", ") || "—"}</td>
                      <td className="reports-cell-num">{r.properties.toLocaleString()}</td>
                      <td>
                        <button type="button" className="reports-open-btn" onClick={() => onOpenCampaign(r.id)}>
                          Open →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: "indigo" | "green" | "orange" }) {
  return (
    <div className={`cpg-stat-card cpg-stat-${color}`}>
      <span className="cpg-stat-icon">{icon}</span>
      <div>
        <span className="cpg-stat-value">{value}</span>
        <span className="cpg-stat-label">{label}</span>
      </div>
    </div>
  );
}
