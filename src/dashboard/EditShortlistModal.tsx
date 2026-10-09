import { useEffect, useState } from "react";
import { CITIES, loadCityScreens, type CityId } from "../data/cities";
import { useToast } from "./Toast";
import "./EditShortlistModal.css";

type PropertyRow = { cityId: CityId; mediaSiteId: string; name: string; locality: string | null; zone: string | null };

type SearchResult = {
  properties: { cityId: string; mediaSiteId: string; name: string; locality: string | null; zone: string | null }[];
};

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

// Add/remove properties on an existing campaign without re-uploading a
// whole new sheet. Loads the campaign's current properties (grouped by
// city, same lazy per-city JSON the map already uses) for removal, and
// reuses the dashboard's own property search (GET /api/search) to find
// and add new ones from any city — not just the ones already in this
// campaign, since expanding a campaign into a new city is a legitimate
// edit too.
export default function EditShortlistModal({
  campaignId,
  initialSelections,
  onClose,
  onSaved,
}: {
  campaignId: string;
  initialSelections: Record<string, string[]>;
  onClose: () => void;
  onSaved: (selections: Record<string, string[]>) => void;
}) {
  const showToast = useToast();
  const [rows, setRows] = useState<PropertyRow[] | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<PropertyRow[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult["properties"]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const collected: PropertyRow[] = [];
      for (const city of CITIES) {
        const ids = initialSelections[city.id];
        if (!ids || ids.length === 0) continue;
        const idSet = new Set(ids);
        const fc = await loadCityScreens(city.id);
        for (const f of fc.features) {
          if (f.properties.mediaSiteId && idSet.has(f.properties.mediaSiteId)) {
            collected.push({
              cityId: city.id,
              mediaSiteId: f.properties.mediaSiteId,
              name: f.properties.name ?? "Untitled property",
              locality: f.properties.locality,
              zone: f.properties.zone,
            });
          }
        }
      }
      if (!cancelled) setRows(collected);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<SearchResult>) : { properties: [] }))
        .then((data) => setSearchResults(data.properties))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const currentKey = (cityId: string, mediaSiteId: string) => `${cityId}:${mediaSiteId}`;

  const alreadyIncluded = (cityId: string, mediaSiteId: string) =>
    (rows ?? []).some((r) => r.cityId === cityId && r.mediaSiteId === mediaSiteId && !removed.has(currentKey(r.cityId, r.mediaSiteId))) ||
    added.some((r) => r.cityId === cityId && r.mediaSiteId === mediaSiteId);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const selections: Record<string, string[]> = {};
    for (const r of rows ?? []) {
      if (removed.has(currentKey(r.cityId, r.mediaSiteId))) continue;
      (selections[r.cityId] ??= []).push(r.mediaSiteId);
    }
    for (const r of added) {
      (selections[r.cityId] ??= []).push(r.mediaSiteId);
    }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/selections`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections }),
      });
      if (!res.ok) throw new Error("Could not save changes");
      const data = (await res.json()) as { selections: Record<string, string[]> };
      onSaved(data.selections);
      showToast("Shortlist updated");
    } catch {
      setError("Could not save changes — try again.");
    } finally {
      setSaving(false);
    }
  };

  const totalCount = (rows?.length ?? 0) - removed.size + added.length;

  return (
    <div className="esm-overlay" onClick={onClose}>
      <div className="esm-card" onClick={(e) => e.stopPropagation()}>
        <div className="esm-header">
          <h2>Edit shortlist</h2>
          <button type="button" className="esm-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="esm-sub">{totalCount.toLocaleString()} properties currently shortlisted.</p>

        <div className="esm-add">
          <input
            type="text"
            placeholder="Search properties to add…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && (
            <div className="esm-add-results">
              {searching && <p className="esm-empty">Searching…</p>}
              {!searching && searchResults.length === 0 && <p className="esm-empty">No matches.</p>}
              {!searching &&
                searchResults.map((p) => {
                  const included = alreadyIncluded(p.cityId, p.mediaSiteId);
                  return (
                    <div key={`${p.cityId}-${p.mediaSiteId}`} className="esm-add-row">
                      <div>
                        <span className="esm-row-name">{p.name}</span>
                        <span className="esm-row-sub">
                          {[p.locality, p.zone].filter(Boolean).join(" · ")} — {cityLabel(p.cityId)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="esm-add-btn"
                        disabled={included}
                        onClick={() => {
                          setAdded((prev) => [...prev, { cityId: p.cityId as CityId, mediaSiteId: p.mediaSiteId, name: p.name, locality: p.locality, zone: p.zone }]);
                          setRemoved((prev) => {
                            const next = new Set(prev);
                            next.delete(currentKey(p.cityId, p.mediaSiteId));
                            return next;
                          });
                        }}
                      >
                        {included ? "Added" : "+ Add"}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="esm-list">
          {rows === null && <p className="esm-empty">Loading current shortlist…</p>}
          {rows !== null && totalCount === 0 && <p className="esm-empty">No properties left — add at least one before saving.</p>}
          {CITIES.map((city) => {
            const cityRows = [
              ...(rows ?? []).filter((r) => r.cityId === city.id && !removed.has(currentKey(r.cityId, r.mediaSiteId))),
              ...added.filter((r) => r.cityId === city.id),
            ];
            if (cityRows.length === 0) return null;
            return (
              <div key={city.id} className="esm-city-group">
                <span className="esm-city-title">
                  {city.label} ({cityRows.length})
                </span>
                {cityRows.map((r) => (
                  <div key={`${r.cityId}-${r.mediaSiteId}`} className="esm-row">
                    <div>
                      <span className="esm-row-name">{r.name}</span>
                      <span className="esm-row-sub">{[r.locality, r.zone].filter(Boolean).join(" · ") || "—"}</span>
                    </div>
                    <button
                      type="button"
                      className="esm-remove-btn"
                      onClick={() => {
                        setRemoved((prev) => new Set(prev).add(currentKey(r.cityId, r.mediaSiteId)));
                        setAdded((prev) => prev.filter((a) => !(a.cityId === r.cityId && a.mediaSiteId === r.mediaSiteId)));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {error && <p className="esm-error">{error}</p>}

        <div className="esm-actions">
          <button type="button" className="esm-cancel-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="esm-save-btn" onClick={handleSave} disabled={saving || rows === null || totalCount === 0}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
