import { useEffect, useMemo, useState } from "react";
import { cityLabel, fetchCampaigns, groupByClient, type CampaignListItem } from "./campaignHistory";
import StatCard from "./StatCard";
import { ArrowRightIcon, BuildingIcon, CampaignsIcon, ClientsIcon, ExportIcon } from "./icons";
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
  // Every campaign's properties, not just the ones surviving the search
  // box — this sits in the same "Total …" stat row as the campaign and
  // client counts, which are both unfiltered, so deriving it from the
  // filtered `rows` made the three disagree the moment anyone typed a query.
  const totalProperties = campaigns
    ? campaigns.reduce((sum, c) => sum + Object.values(c.counts).reduce((n, count) => n + count, 0), 0)
    : 0;

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
    // The anchor has to be in the document for the click to count as a
    // user-initiated download in Firefox — a detached one silently did
    // nothing there. And revoking the blob URL synchronously after click()
    // can pull it out from under the download before the browser has read
    // it, so that waits a tick.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
            <StatCard icon={<CampaignsIcon />} label="Total Campaigns" value={campaigns.length.toLocaleString()} tone="indigo" />
            <StatCard icon={<ClientsIcon />} label="Clients Served" value={totalClients.toLocaleString()} tone="green" />
            <StatCard icon={<BuildingIcon />} label="Properties Shortlisted" value={totalProperties.toLocaleString()} tone="orange" />
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
                <ExportIcon size={14} /> Export CSV
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
                          Open <ArrowRightIcon size={13} />
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

