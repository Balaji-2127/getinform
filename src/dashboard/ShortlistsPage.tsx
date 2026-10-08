import { useEffect, useState } from "react";
import { CITIES, type CityId } from "../data/cities";
import "./CampaignsPage.css";
import "./ShortlistsPage.css";

type PopularProperty = {
  cityId: string;
  mediaSiteId: string;
  name: string;
  locality: string | null;
  zone: string | null;
  count: number;
  clients: string[];
};

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

// Not another "list of campaigns" — Reports and Clients already cover
// that. This is a real aggregate over every campaign's actual selections
// (see server/routes/shortlists.ts): which properties get independently
// picked across *multiple* campaigns. A property several different
// clients have shortlisted on their own is a genuine signal worth
// surfacing, not a fabricated number.
export default function ShortlistsPage({ onOpenProperty }: { onOpenProperty: (cityId: CityId, mediaSiteId: string) => void }) {
  const [properties, setProperties] = useState<PopularProperty[] | null>(null);

  useEffect(() => {
    fetch("/api/shortlists/popular")
      .then((r) => (r.ok ? (r.json() as Promise<PopularProperty[]>) : []))
      .then(setProperties)
      .catch(() => setProperties([]));
  }, []);

  const repeated = properties?.filter((p) => p.count > 1) ?? [];

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">SAVED</span>
          <h1>Shortlists</h1>
          <p>Properties that show up across more than one campaign's shortlist — real demand, not a guess.</p>
        </div>
      </div>

      {properties === null && (
        <div className="cpg-empty">
          <p>Loading…</p>
        </div>
      )}

      {properties !== null && properties.length === 0 && (
        <div className="cpg-empty">
          <p>No campaigns uploaded yet — this fills in once there's real shortlist data to compare.</p>
        </div>
      )}

      {properties !== null && properties.length > 0 && repeated.length === 0 && (
        <div className="cpg-empty">
          <p>No property has been shortlisted in more than one campaign yet — check back as more campaigns come in.</p>
        </div>
      )}

      {repeated.length > 0 && (
        <div className="slp-list">
          {repeated.map((p) => (
            <button key={`${p.cityId}-${p.mediaSiteId}`} type="button" className="slp-row" onClick={() => onOpenProperty(p.cityId as CityId, p.mediaSiteId)}>
              <div className="slp-row-text">
                <span className="slp-row-main">{p.name}</span>
                <span className="slp-row-sub">
                  {[p.locality, p.zone].filter(Boolean).join(" · ")}
                  {p.locality || p.zone ? " — " : ""}
                  {cityLabel(p.cityId)}
                </span>
                <span className="slp-row-clients">Shortlisted by {p.clients.join(", ")}</span>
              </div>
              <span className="slp-row-count">
                <span className="slp-row-count-num">{p.count}</span>
                <span className="slp-row-count-label">campaigns</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
