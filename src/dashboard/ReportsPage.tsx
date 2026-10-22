import { useEffect, useMemo, useState } from "react";
import { cityLabel, fetchCampaigns, formatViewTime, groupByClient, type CampaignListItem } from "./campaignHistory";
import StatCard from "./StatCard";
import { ArrowRightIcon, BuildingIcon, CampaignsIcon, ClientsIcon, ExportIcon, InboxIcon, SearchIcon, TrashIcon } from "./icons";
import DeleteCampaignDialog, { type DeletableCampaign } from "./DeleteCampaignDialog";
import "./CampaignsPage.css";
import "./ReportsPage.css";

type SortKey = "date" | "properties" | "client";

// A full, exportable listing of every campaign — built from the same
// GET /api/campaigns data Dashboard/Clients already use, just shown as a
// complete sortable table instead of a "recent 5" or a client-grouped
// view. No invented revenue/performance numbers (this app has no ad-spend
// or delivery tracking) — only what's actually known: who, what, when,
// where, and how many properties.
export default function ReportsPage({
  onOpenCampaign,
  onCampaignDeleted,
}: {
  onOpenCampaign: (campaignId: string) => void;
  // Lets the shell forget a campaign it was holding open. Without this,
  // deleting the campaign currently loaded on the Campaigns tab leaves that
  // tab showing "Campaign not found" the next time you switch to it.
  onCampaignDeleted?: (campaignId: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [pendingDelete, setPendingDelete] = useState<DeletableCampaign | null>(null);

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
    const header = ["Client", "Campaign", "Date", "Cities", "Properties shortlisted", "Client opens", "Client time on map"];
    const lines = rows.map((r) =>
      [
        r.clientName,
        r.campaignName,
        new Date(r.createdAt).toLocaleDateString(),
        r.cities.join(" / "),
        String(r.properties),
        String(r.views),
        r.viewSeconds > 0 ? formatViewTime(r.viewSeconds) : "",
      ]
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
        <>
          {/* The final layout, in skeleton: three stat cards and a table of
              six rows, rather than a sentence that then gets replaced. */}
          <div className="cpg-stats-row">
            <StatCard icon={<CampaignsIcon />} label="Total Campaigns" value={null} tone="indigo" />
            <StatCard icon={<ClientsIcon />} label="Clients Served" value={null} tone="green" />
            <StatCard icon={<BuildingIcon />} label="Properties Shortlisted" value={null} tone="orange" />
          </div>
          <div className="reports-table-wrap" role="status" aria-label="Loading report">
            <div className="reports-skel-head" />
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="reports-skel-row">
                <span className="skel" style={{ width: "70%" }} />
                <span className="skel" style={{ width: "60%" }} />
                <span className="skel" style={{ width: "55%" }} />
                <span className="skel" style={{ width: "65%" }} />
                <span className="skel" style={{ width: "40%" }} />
                <span className="skel" style={{ width: "60%" }} />
                <span className="skel" style={{ width: "50%" }} />
              </div>
            ))}
          </div>
        </>
      )}

      {campaigns !== null && campaigns.length === 0 && (
        <div className="cpg-empty">
          <span className="empty-icon">
            <InboxIcon size={22} />
          </span>
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
            <div className="field-wrap reports-search-wrap">
              <SearchIcon size={15} />
              <input
                type="text"
                className="reports-search"
                placeholder="Search by client or campaign…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="reports-toolbar-right">
              <label className="reports-sort-label">
                Sort by
                <select className="field" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  <option value="date">Newest first</option>
                  <option value="properties">Most properties</option>
                  <option value="client">Client name</option>
                </select>
              </label>
              <button type="button" className="reports-export-btn btn btn-primary" onClick={exportCsv}>
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
                    <th className="reports-col-date">Date</th>
                    <th className="reports-col-cities">Cities</th>
                    <th className="reports-col-num">
                      <span className="reports-label-full">Properties</span>
                      <span className="reports-label-short">Props</span>
                    </th>
                    <th className="reports-col-views" title="How many times the client opened the share link, and how long it was on their screen in total. Your team's own visits aren't counted.">
                      Client views
                    </th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="reports-cell-strong">{r.clientName}</td>
                      <td>{r.campaignName}</td>
                      <td className="reports-cell-muted reports-cell-date reports-col-date">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="reports-cell-muted reports-col-cities">
                        {r.cities.length > 0 ? (
                          <span className="reports-cities">
                            {r.cities.map((city) => (
                              <span key={city} className="badge">
                                {city}
                              </span>
                            ))}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="reports-cell-num reports-col-num">{r.properties.toLocaleString()}</td>
                      <td className="reports-col-views">
                        {r.views > 0 ? (
                          <>
                            <span className="badge badge-success badge-dot reports-views-count">
                              {r.views.toLocaleString()} {r.views === 1 ? "open" : "opens"}
                            </span>
                            <span className="reports-views-time">{formatViewTime(r.viewSeconds)} on map</span>
                          </>
                        ) : (
                          <span className="badge badge-muted">Not opened yet</span>
                        )}
                      </td>
                      <td>
                        <div className="reports-row-actions">
                          <button
                            type="button"
                            className="reports-open-btn btn btn-secondary btn-sm"
                            onClick={() => onOpenCampaign(r.id)}
                            aria-label={`Open ${r.clientName} — ${r.campaignName}`}
                          >
                            <span className="reports-label-full">Open</span> <ArrowRightIcon size={13} />
                          </button>
                          <button
                            type="button"
                            className="reports-delete-btn btn btn-ghost btn-icon btn-sm"
                            title={`Delete "${r.clientName} — ${r.campaignName}"`}
                            aria-label={`Delete campaign ${r.clientName} — ${r.campaignName}`}
                            onClick={() => setPendingDelete({ id: r.id, clientName: r.clientName, campaignName: r.campaignName, properties: r.properties })}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {pendingDelete && (
        <DeleteCampaignDialog
          campaign={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onDeleted={(id) => {
            setCampaigns((prev) => prev?.filter((c) => c.id !== id) ?? null);
            onCampaignDeleted?.(id);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

