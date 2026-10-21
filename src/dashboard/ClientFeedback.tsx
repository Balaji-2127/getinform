import { useEffect, useMemo, useState } from "react";
import { CITIES, loadCityScreens, type CityId } from "../data/cities";
import type { CampaignReview } from "../review";
import { useToast } from "./Toast";
import "./ClientFeedback.css";

type Row = { id: string; cityId: CityId; name: string; locality: string | null; removed: boolean; added: boolean; comment: string | null };

// What the client said on their share link, laid out for the sales team:
// approval status, their overall note, and every property they removed,
// added or commented on — plus one click to apply their changes to the
// shortlist.
export default function ClientFeedback({
  campaignId,
  selections,
  review,
  onApplied,
  onRefresh,
}: {
  campaignId: string;
  selections: Record<string, string[]>;
  review: CampaignReview | null;
  onApplied: (selections: Record<string, string[]>) => void;
  onRefresh: () => void;
}) {
  const showToast = useToast();
  const [names, setNames] = useState<Record<string, { name: string; locality: string | null }>>({});
  const [applying, setApplying] = useState(false);

  // Only what still applies to the shortlist as it stands now.
  const rows: Row[] = useMemo(() => {
    if (!review) return [];
    const removed = new Set(review.removed);
    const onShortlist = new Set(Object.values(selections).flat());
    const out: Row[] = [];
    const push = (id: string, cityId: CityId, isAdded: boolean) => {
      const comment = review.comments[id] ?? null;
      const isRemoved = !isAdded && removed.has(id);
      if (!isRemoved && !isAdded && !comment) return;
      out.push({ id, cityId, name: names[id]?.name ?? id, locality: names[id]?.locality ?? null, removed: isRemoved, added: isAdded, comment });
    };
    for (const city of CITIES) {
      for (const id of selections[city.id] ?? []) push(id, city.id, false);
      for (const id of review.added?.[city.id] ?? []) if (!onShortlist.has(id)) push(id, city.id, true);
    }
    // Changes first — they're the ones that need acting on.
    const rank = (r: Row) => (r.removed ? 2 : r.added ? 1 : 0);
    return out.sort((a, b) => rank(b) - rank(a));
  }, [review, selections, names]);

  const citiesNeeded = [...new Set(rows.map((r) => r.cityId))].join(",");
  useEffect(() => {
    if (!citiesNeeded) return;
    let cancelled = false;
    Promise.all(citiesNeeded.split(",").map((c) => loadCityScreens(c as CityId).catch(() => null))).then((collections) => {
      if (cancelled) return;
      const next: Record<string, { name: string; locality: string | null }> = {};
      for (const fc of collections) {
        for (const f of fc?.features ?? []) {
          const p = f.properties;
          if (p.mediaSiteId) next[p.mediaSiteId] = { name: p.name ?? p.mediaSiteId, locality: p.locality };
        }
      }
      setNames(next);
    });
    return () => {
      cancelled = true;
    };
  }, [citiesNeeded]);

  if (!review) return null;
  const removedRows = rows.filter((r) => r.removed);
  const addedRows = rows.filter((r) => r.added);
  const approved = review.status === "approved";
  const commentCount = rows.filter((r) => r.comment).length;
  if (!approved && rows.length === 0 && !review.note) return null;

  const applyRemovals = async () => {
    const drop = new Set(removedRows.map((r) => r.id));
    const next: Record<string, string[]> = {};
    for (const [city, ids] of Object.entries(selections)) {
      const kept = ids.filter((id) => !drop.has(id));
      if (kept.length > 0) next[city] = kept;
    }
    for (const r of addedRows) next[r.cityId] = [...(next[r.cityId] ?? []), r.id];
    if (Object.keys(next).length === 0) {
      showToast("The client removed every property — edit the shortlist instead", "error");
      return;
    }
    setApplying(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/selections`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: next }),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { selections: Record<string, string[]> };
      onApplied(body.selections);
      showToast(
        [drop.size > 0 && `Removed ${drop.size}`, addedRows.length > 0 && `added ${addedRows.length}`].filter(Boolean).join(", ") +
          ` ${drop.size + addedRows.length === 1 ? "property" : "properties"} — the shortlist now matches the client's`,
      );
    } catch {
      showToast("Couldn't update the shortlist — try again", "error");
    } finally {
      setApplying(false);
    }
  };

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <section className={"cfb" + (approved ? " is-approved" : "")} aria-label="Client feedback">
      <header className="cfb-head">
        <span className={"cfb-status" + (approved ? " is-approved" : "")}>
          {approved ? `Approved${review.approvedBy ? ` by ${review.approvedBy}` : ""}` : "Client is reviewing"}
        </span>
        <span className="cfb-meta">
          {approved ? when(review.approvedAt) : `Last change ${when(review.updatedAt)}`}
          {" · "}
          {removedRows.length} removed · {addedRows.length} added · {commentCount} {commentCount === 1 ? "comment" : "comments"}
        </span>
        <div className="cfb-actions">
          <button type="button" className="cfb-btn" onClick={onRefresh}>
            Refresh
          </button>
          {(removedRows.length > 0 || addedRows.length > 0) && (
            <button type="button" className="cfb-btn is-primary" disabled={applying} onClick={applyRemovals}>
              {applying
                ? "Updating…"
                : `Apply client's changes (${[removedRows.length > 0 && `−${removedRows.length}`, addedRows.length > 0 && `+${addedRows.length}`]
                    .filter(Boolean)
                    .join(" ")})`}
            </button>
          )}
        </div>
      </header>

      {review.note && <blockquote className="cfb-note">{review.note}</blockquote>}

      {rows.length > 0 && (
        <ul className="cfb-list">
          {rows.map((r) => (
            <li key={r.id} className="cfb-row">
              <div className="cfb-row-main">
                <span className="cfb-row-name">{r.name}</span>
                <span className="cfb-row-sub">
                  {[r.locality, CITIES.find((c) => c.id === r.cityId)?.label].filter(Boolean).join(" · ")}
                </span>
              </div>
              {r.removed && <span className="cfb-tag">Removed</span>}
              {r.added && <span className="cfb-tag is-added">Added</span>}
              {r.comment && <p className="cfb-row-comment">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
