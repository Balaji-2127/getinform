import { useEffect, useMemo, useState } from "react";
import type { ProjectFeature } from "./google/clustering";
import type { MapReview } from "./review";
import { CloseIcon, PlusIcon, RestartIcon } from "./dashboard/icons";
import "./ShortlistList.css";

// How many inventory matches the "Add more properties" search shows at once.
const MAX_ADD_RESULTS = 8;

const inr = (n: number | null) => (n ? `₹${n.toLocaleString("en-IN")}` : "—");

// The client's shortlist for the city on screen, as a list under the
// campaign banner: every property the sales team picked (with Remove /
// Undo), the ones the client added (with Remove), and a search over the
// rest of Adonmo's inventory in that city to add more. Clicking a name flies
// the map to it. Editing goes through the same review as the map's own
// property panel, so the two always agree.
export default function ShortlistList({
  cityId,
  cityLabel,
  features,
  shortlisted,
  review,
  onFocus,
  onClose,
}: {
  cityId: string;
  cityLabel: string;
  features: ProjectFeature[];
  shortlisted: Set<string>;
  review: MapReview;
  onFocus: (feature: ProjectFeature) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const editable = review.audience === "client" && Boolean(review.onSetRemoved) && !review.locked;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const byName = (a: ProjectFeature, b: ProjectFeature) => (a.properties.name ?? "").localeCompare(b.properties.name ?? "");
  const matches = (f: ProjectFeature, q: string) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const p = f.properties;
    return [p.name, p.locality, p.zone].some((v) => (v ?? "").toLowerCase().includes(needle));
  };

  // The inventory files list a few properties more than once under the same
  // id (e.g. one row per screen package); the first row stands for it here,
  // the same one the rest of the app uses.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return features.filter((f) => {
      const id = f.properties.mediaSiteId;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [features]);

  const { picked, added } = useMemo(() => {
    const picked: ProjectFeature[] = [];
    const added: ProjectFeature[] = [];
    for (const f of unique) {
      const id = f.properties.mediaSiteId;
      if (!id) continue;
      if (shortlisted.has(id)) picked.push(f);
      else if (review.added.has(id)) added.push(f);
    }
    return { picked: picked.sort(byName), added: added.sort(byName) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, shortlisted, review.added]);

  const addResults = useMemo(() => {
    if (addQuery.trim().length < 2) return [];
    return unique
      .filter((f) => {
        const id = f.properties.mediaSiteId;
        return id && !shortlisted.has(id) && !review.added.has(id) && matches(f, addQuery);
      })
      .sort(byName)
      .slice(0, MAX_ADD_RESULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, shortlisted, review.added, addQuery]);

  const removedCount = picked.filter((f) => review.removed.has(f.properties.mediaSiteId!)).length;
  const total = picked.length - removedCount + added.length;
  const visiblePicked = picked.filter((f) => matches(f, filter));
  const visibleAdded = added.filter((f) => matches(f, filter));

  const row = (f: ProjectFeature, kind: "picked" | "added") => {
    const p = f.properties;
    const id = p.mediaSiteId!;
    const removed = kind === "picked" && review.removed.has(id);
    return (
      <li key={id} className={"sl-row" + (removed ? " is-removed" : "") + (kind === "added" ? " is-added" : "")}>
        <button type="button" className="sl-row-main" onClick={() => onFocus(f)} title="Show on the map">
          <span className="sl-row-name">{p.name ?? id}</span>
          <span className="sl-row-sub">
            {[p.locality, p.households ? `${p.households.toLocaleString("en-IN")} homes` : null, `${inr(p.monthlyAdBudget)}/mo`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
        {kind === "added" && <span className="sl-tag is-added">Added</span>}
        {removed && <span className="sl-tag is-removed">Removed</span>}
        {review.comments[id] && <span className="sl-tag" title={review.comments[id]}>Comment</span>}
        {editable &&
          (kind === "added" ? (
            <button type="button" className="sl-action" onClick={() => review.onSetAdded?.(cityId, id, false)} title="Remove from my shortlist">
              <CloseIcon size={13} /> Remove
            </button>
          ) : removed ? (
            <button type="button" className="sl-action is-undo" onClick={() => review.onSetRemoved?.(id, false)} title="Put it back">
              <RestartIcon size={12} /> Undo
            </button>
          ) : (
            <button type="button" className="sl-action" onClick={() => review.onSetRemoved?.(id, true)} title="Remove from my shortlist">
              <CloseIcon size={13} /> Remove
            </button>
          ))}
      </li>
    );
  };

  return (
    <div className="sl" role="region" aria-label={`Shortlist in ${cityLabel}`}>
      <div className="sl-head">
        <strong>
          {total} {total === 1 ? "property" : "properties"} in {cityLabel}
        </strong>
        <button type="button" className="sl-close" onClick={onClose} aria-label="Close the list">
          <CloseIcon size={14} />
        </button>
      </div>

      {review.locked && <p className="sl-hint">You've approved this shortlist. Choose "Make changes" at the bottom to edit it.</p>}

      <input className="sl-input" type="search" placeholder="Filter by name or locality" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <ul className="sl-list">
        {visibleAdded.map((f) => row(f, "added"))}
        {visiblePicked.map((f) => row(f, "picked"))}
        {visiblePicked.length + visibleAdded.length === 0 && <li className="sl-empty">Nothing matches "{filter}".</li>}
      </ul>

      {editable && (
        <div className="sl-add">
          <span className="sl-add-title">Add more properties</span>
          <input
            className="sl-input"
            type="search"
            placeholder={`Search Adonmo's other properties in ${cityLabel}`}
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
          />
          {addQuery.trim().length >= 2 ? (
            addResults.length > 0 ? (
              <ul className="sl-list is-results">
                {addResults.map((f) => {
                  const p = f.properties;
                  return (
                    <li key={p.mediaSiteId} className="sl-row">
                      <button type="button" className="sl-row-main" onClick={() => onFocus(f)} title="Show on the map">
                        <span className="sl-row-name">{p.name ?? p.mediaSiteId}</span>
                        <span className="sl-row-sub">
                          {[p.locality, p.households ? `${p.households.toLocaleString("en-IN")} homes` : null, `${inr(p.monthlyAdBudget)}/mo`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                      <button type="button" className="sl-action is-add" onClick={() => review.onSetAdded?.(cityId, p.mediaSiteId!, true)}>
                        <PlusIcon size={13} /> Add
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="sl-hint">No other properties match "{addQuery.trim()}".</p>
            )
          ) : (
            <p className="sl-hint">Type a society or locality name — or click any green pin on the map.</p>
          )}
        </div>
      )}
    </div>
  );
}
