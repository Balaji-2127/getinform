import { useEffect, useState } from "react";
import { CITIES, type CityId } from "../data/cities";
import "./CampaignsPage.css";
import "./RecentSearchesPage.css";

type SearchHistoryEntry = {
  id: string;
  query: string;
  resultType: "campaign" | "property";
  resultLabel: string;
  resultSub: string | null;
  cityId: string | null;
  targetId: string;
  createdAt: string;
};

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A real log of what's actually been searched and opened from the
// dashboard's global search (see GlobalSearch.tsx's logSearchHistory) —
// not a placeholder. Only records a result someone actually clicked, so
// this reads as "what people went looking for and found," not keystroke
// noise.
export default function RecentSearchesPage({
  onOpenCampaign,
  onOpenProperty,
}: {
  onOpenCampaign: (campaignId: string) => void;
  onOpenProperty: (cityId: CityId, mediaSiteId: string) => void;
}) {
  const [entries, setEntries] = useState<SearchHistoryEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/search-history")
      .then((r) => (r.ok ? (r.json() as Promise<SearchHistoryEntry[]>) : []))
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">SAVED</span>
          <h1>Recent Searches</h1>
          <p>Every search result you've actually opened from the dashboard's search bar, most recent first.</p>
        </div>
      </div>

      {entries === null && (
        <div className="cpg-empty">
          <p>Loading…</p>
        </div>
      )}

      {entries !== null && entries.length === 0 && (
        <div className="cpg-empty">
          <p>Nothing searched yet — use the search bar at the top of the dashboard and it'll show up here.</p>
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="rsp-list">
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              className="rsp-row"
              onClick={() => (e.resultType === "campaign" ? onOpenCampaign(e.targetId) : onOpenProperty(e.cityId as CityId, e.targetId))}
            >
              <span className={`rsp-type-icon rsp-type-${e.resultType}`}>{e.resultType === "campaign" ? "📢" : "🏢"}</span>
              <div className="rsp-row-text">
                <span className="rsp-row-main">{e.resultLabel}</span>
                <span className="rsp-row-sub">
                  {e.resultSub ? `${e.resultSub} · ` : ""}
                  {e.cityId ? `${cityLabel(e.cityId)} · ` : ""}
                  searched "{e.query}"
                </span>
              </div>
              <span className="rsp-row-when">{formatWhen(e.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
