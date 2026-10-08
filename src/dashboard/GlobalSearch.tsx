import { useEffect, useRef, useState } from "react";
import { CITIES, type CityId } from "../data/cities";
import { SearchIcon } from "./icons";
import "./GlobalSearch.css";

type SearchResult = {
  campaigns: { id: string; clientName: string; campaignName: string; createdAt: string }[];
  properties: { cityId: string; mediaSiteId: string; name: string; locality: string | null; zone: string | null }[];
};

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

// Fire-and-forget — logs a search result the rep actually opened (never
// every keystroke) so "Recent Searches" in the sidebar is a real record
// of what people looked for and found. A failure here never blocks the
// actual navigation it's attached to.
function logSearchHistory(entry: {
  query: string;
  resultType: "campaign" | "property";
  resultLabel: string;
  resultSub?: string;
  cityId?: string;
  targetId: string;
}) {
  fetch("/api/search-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => {});
}

// The dashboard topbar's search box — previously static placeholder text
// with no actual search behind it. Debounced against the server (which
// searches campaigns/clients and every city's property data in one call —
// see server/routes/search.ts), with results grouped and clickable:
// a campaign result opens that campaign, a property result jumps to it
// on the Inventory map (switching city first if needed).
export default function GlobalSearch({
  onOpenCampaign,
  onOpenProperty,
}: {
  onOpenCampaign: (campaignId: string) => void;
  onOpenProperty: (cityId: CityId, mediaSiteId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<SearchResult>) : { campaigns: [], properties: [] }))
        .then((data) => setResult(data))
        .catch(() => setResult({ campaigns: [], properties: [] }))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // Click-outside closes the results dropdown without clearing what was typed.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const hasResults = result && (result.campaigns.length > 0 || result.properties.length > 0);

  return (
    <div className="gs-root" ref={containerRef}>
      <div className="gs-bar">
        <SearchIcon size={15} />
        <input
          type="text"
          placeholder="Search properties, localities, clients, or keywords…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {!query && <span className="gs-kbd">Ctrl K</span>}
      </div>

      {open && query.trim() && (
        <div className="gs-dropdown">
          {loading && <p className="gs-empty">Searching…</p>}
          {!loading && !hasResults && <p className="gs-empty">No matches for "{query.trim()}".</p>}
          {!loading && result && result.campaigns.length > 0 && (
            <div className="gs-group">
              <span className="gs-group-title">Campaigns</span>
              {result.campaigns.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="gs-result"
                  onClick={() => {
                    logSearchHistory({
                      query: query.trim(),
                      resultType: "campaign",
                      resultLabel: c.clientName,
                      resultSub: c.campaignName,
                      targetId: c.id,
                    });
                    onOpenCampaign(c.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="gs-result-main">{c.clientName}</span>
                  <span className="gs-result-sub">{c.campaignName}</span>
                </button>
              ))}
            </div>
          )}
          {!loading && result && result.properties.length > 0 && (
            <div className="gs-group">
              <span className="gs-group-title">Properties</span>
              {result.properties.map((p) => (
                <button
                  key={`${p.cityId}-${p.mediaSiteId}`}
                  type="button"
                  className="gs-result"
                  onClick={() => {
                    logSearchHistory({
                      query: query.trim(),
                      resultType: "property",
                      resultLabel: p.name,
                      resultSub: [p.locality, p.zone].filter(Boolean).join(" · "),
                      cityId: p.cityId,
                      targetId: p.mediaSiteId,
                    });
                    onOpenProperty(p.cityId as CityId, p.mediaSiteId);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="gs-result-main">{p.name}</span>
                  <span className="gs-result-sub">
                    {[p.locality, p.zone].filter(Boolean).join(" · ")}
                    {p.locality || p.zone ? " — " : ""}
                    {cityLabel(p.cityId)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
