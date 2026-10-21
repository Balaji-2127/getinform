import { useEffect, useMemo, useState } from "react";
import { CITIES, loadCityScreens, type CityId } from "../data/cities";
import type { CampaignReview } from "../review";
import { useToast } from "./Toast";
import { CheckIcon, CloseIcon } from "./icons";
import "./ClientFeedback.css";

// One line of the client's feedback: a property they want removed, added,
// or just commented on. `decision` is what the sales team has done about
// it so far.
type Row = {
  id: string;
  cityId: CityId;
  name: string;
  locality: string | null;
  change: "remove" | "add" | null;
  decision: "pending" | "accepted" | "declined" | null;
  comment: string | null;
};

type DecisionResponse = { selections: Record<string, string[]>; review: CampaignReview };

// What the client said on their share link, laid out for the sales team:
// approval status, their overall note, and every property they want
// removed or added — each with Accept / Decline — plus their comments.
// Accepting changes the real shortlist; declining just records the
// decision, so the request stops showing as pending without touching the
// client's own copy of what they asked for.
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
  onApplied: (result: DecisionResponse) => void;
  onRefresh: () => void;
}) {
  const showToast = useToast();
  const [names, setNames] = useState<Record<string, { name: string; locality: string | null; cityId: CityId }>>({});
  const [busy, setBusy] = useState<string | null>(null); // "all" or a property id

  const rows: Row[] = useMemo(() => {
    if (!review) return [];
    const removed = new Set(review.removed);
    const onShortlist = new Set(Object.values(selections).flat());
    const resolved = review.resolved ?? {};
    const out: Row[] = [];
    const push = (id: string, cityId: CityId, change: Row["change"], decision?: Row["decision"]) => {
      const comment = review.comments[id] ?? null;
      if (!change && !comment) return;
      out.push({
        id,
        cityId,
        name: names[id]?.name ?? id,
        locality: names[id]?.locality ?? null,
        change,
        decision: change ? (decision ?? resolved[id] ?? "pending") : null,
        comment,
      });
    };
    for (const city of CITIES) {
      for (const id of selections[city.id] ?? []) push(id, city.id, removed.has(id) ? "remove" : null);
      // A removal already accepted has left the shortlist; still shown, so
      // the team can see what was done. (Its city isn't recorded, so it's
      // matched by the city's inventory names loaded below.)
      for (const id of review.removed) {
        if (!onShortlist.has(id) && resolved[id] === "accepted" && names[id] && names[id].cityId === city.id) push(id, city.id, "remove", "accepted");
      }
      for (const id of review.added?.[city.id] ?? []) {
        // An addition already on the shortlist was accepted earlier: shown
        // as such rather than as a fresh request.
        if (onShortlist.has(id)) {
          if (resolved[id] === "accepted") push(id, city.id, "add", "accepted");
          continue;
        }
        push(id, city.id, "add");
      }
    }
    // Pending requests first — they're the ones that need acting on.
    const rank = (r: Row) => (r.decision === "pending" ? 2 : r.change ? 1 : 0);
    return out.sort((a, b) => rank(b) - rank(a));
  }, [review, selections, names]);

  // Every city the campaign touches, so accepted removals (no longer on
  // the shortlist) can still be named.
  const citiesNeeded = [...new Set([...Object.keys(selections), ...Object.keys(review?.added ?? {})])].join(",");
  useEffect(() => {
    if (!citiesNeeded) return;
    let cancelled = false;
    const cityIds = citiesNeeded.split(",") as CityId[];
    Promise.all(cityIds.map((c) => loadCityScreens(c).catch(() => null))).then((collections) => {
      if (cancelled) return;
      const next: Record<string, { name: string; locality: string | null; cityId: CityId }> = {};
      collections.forEach((fc, i) => {
        for (const f of fc?.features ?? []) {
          const p = f.properties;
          if (p.mediaSiteId && !next[p.mediaSiteId]) next[p.mediaSiteId] = { name: p.name ?? p.mediaSiteId, locality: p.locality, cityId: cityIds[i] };
        }
      });
      setNames(next);
    });
    return () => {
      cancelled = true;
    };
  }, [citiesNeeded]);

  if (!review) return null;
  const pending = rows.filter((r) => r.decision === "pending");
  const pendingRemovals = pending.filter((r) => r.change === "remove").length;
  const pendingAdds = pending.filter((r) => r.change === "add").length;
  const approved = review.status === "approved";
  const commentCount = rows.filter((r) => r.comment).length;
  if (!approved && rows.length === 0 && !review.note) return null;

  const decide = async (accept: string[], decline: string[], key: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/review/decisions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, decline }),
      });
      const body = (await res.json().catch(() => null)) as (DecisionResponse & { error?: string }) | null;
      if (!res.ok || !body?.selections) throw new Error(body?.error ?? "");
      onApplied(body);
      const n = accept.length + decline.length;
      showToast(accept.length > 0 ? `Shortlist updated — ${n === 1 ? "1 request" : `${n} requests`} handled` : "Request declined");
    } catch (e) {
      showToast((e as Error).message || "Couldn't save the decision — try again", "error");
    } finally {
      setBusy(null);
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
          {pending.length === 0
            ? "no pending requests"
            : [pendingRemovals > 0 && `${pendingRemovals} to remove`, pendingAdds > 0 && `${pendingAdds} to add`].filter(Boolean).join(" · ") + " pending"}
          {commentCount > 0 && ` · ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
        </span>
        <div className="cfb-actions">
          <button type="button" className="cfb-btn" onClick={onRefresh} disabled={busy !== null}>
            Refresh
          </button>
          {pending.length > 1 && (
            <button type="button" className="cfb-btn is-primary" disabled={busy !== null} onClick={() => decide(pending.map((r) => r.id), [], "all")}>
              {busy === "all" ? "Updating…" : `Accept all ${pending.length} requests`}
            </button>
          )}
        </div>
      </header>

      {review.note && <blockquote className="cfb-note">{review.note}</blockquote>}

      {rows.length > 0 && (
        <ul className="cfb-list">
          {rows.map((r) => (
            <li key={r.id} className={"cfb-row" + (r.decision === "pending" ? " is-pending" : "")}>
              <div className="cfb-row-main">
                <span className="cfb-row-name">{r.name}</span>
                <span className="cfb-row-sub">{[r.locality, CITIES.find((c) => c.id === r.cityId)?.label].filter(Boolean).join(" · ")}</span>
              </div>
              {r.change && (
                <span className={"cfb-tag" + (r.change === "add" ? " is-added" : "")}>
                  {r.decision === "pending" ? (r.change === "remove" ? "Wants it removed" : "Wants it added") : r.change === "remove" ? "Removal" : "Addition"}
                </span>
              )}
              {r.decision === "accepted" && (
                <span className="cfb-tag is-done">
                  <CheckIcon size={11} /> Accepted
                </span>
              )}
              {r.decision === "declined" && <span className="cfb-tag is-declined">Declined</span>}
              {r.decision === "pending" && (
                <span className="cfb-row-actions">
                  <button
                    type="button"
                    className="cfb-btn is-accept"
                    disabled={busy !== null}
                    onClick={() => decide([r.id], [], r.id)}
                    title={r.change === "remove" ? "Remove it from the shortlist" : "Add it to the shortlist"}
                  >
                    <CheckIcon size={12} /> {busy === r.id ? "…" : "Accept"}
                  </button>
                  <button type="button" className="cfb-btn is-decline" disabled={busy !== null} onClick={() => decide([], [r.id], r.id)} title="Leave the shortlist as it is">
                    <CloseIcon size={12} /> Decline
                  </button>
                </span>
              )}
              {r.comment && <p className="cfb-row-comment">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
