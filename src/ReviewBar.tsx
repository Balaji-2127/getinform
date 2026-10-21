import { useEffect, useState } from "react";
import { CITIES } from "./data/cities";
import type { CampaignReview } from "./review";
import type { SaveState } from "./ClientCampaignView";
import { CheckIcon } from "./dashboard/icons";
import "./ReviewBar.css";

// The client's running tally along the bottom of their link — how many
// properties they're keeping, removing and have commented on — and the one
// button that turns their picks into a sign-off the sales team can act on.
export default function ReviewBar({
  selections,
  review,
  saveState,
  liveNote,
  onApprove,
  onReopen,
}: {
  selections: Record<string, string[]>;
  review: CampaignReview;
  saveState: SaveState;
  // Briefly shown after the sales team changed the shortlist underneath.
  liveNote?: string | null;
  onApprove: (approvedBy: string, note: string) => Promise<boolean>;
  onReopen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const shortlist = new Set(Object.values(selections).flat());
  const total = shortlist.size;
  const removed = review.removed.filter((id) => shortlist.has(id)).length;
  const addedIds = Object.values(review.added ?? {}).flat().filter((id) => !shortlist.has(id));
  const added = addedIds.length;
  const comments = Object.keys(review.comments).filter((id) => shortlist.has(id)).length;
  // What they'd be approving: what's left of the original, plus additions.
  const kept = total - removed + added;
  const touched = removed > 0 || added > 0 || comments > 0;

  if (review.status === "approved") {
    return (
      <div className="review-bar is-approved" role="status">
        <span className="review-bar-icon">
          <CheckIcon size={14} />
        </span>
        <div className="review-bar-text">
          <strong>You approved this shortlist</strong>
          <span>
            {kept} {kept === 1 ? "property" : "properties"}
            {review.approvedAt ? ` · ${new Date(review.approvedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
            {" · "}the Adonmo team can now see it
          </span>
        </div>
        <button type="button" className="review-bar-secondary" onClick={onReopen}>
          Make changes
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="review-bar">
        <div className="review-bar-text">
          <strong>
            {touched
              ? `${kept} ${kept === 1 ? "property" : "properties"} in your shortlist`
              : `${total} ${total === 1 ? "property" : "properties"} shortlisted for you`}
          </strong>
          <span>
            {touched
              ? [removed > 0 && `${removed} removed`, added > 0 && `${added} added`, comments > 0 && `${comments} ${comments === 1 ? "comment" : "comments"}`]
                  .filter(Boolean)
                  .join(" · ")
              : "Tap Properties at the top, or any pin, to remove or add properties"}
            {liveNote && <em className="review-bar-save is-live"> · {liveNote}</em>}
            {saveState === "saving" && <em className="review-bar-save"> · Saving…</em>}
            {saveState === "saved" && <em className="review-bar-save"> · Saved</em>}
            {saveState === "error" && <em className="review-bar-save is-error"> · Couldn't save — check your connection</em>}
          </span>
        </div>
        <button type="button" className="review-bar-primary" disabled={kept === 0} onClick={() => setConfirming(true)}>
          <CheckIcon size={14} /> Approve shortlist
        </button>
      </div>

      {confirming && (
        <ApproveDialog
          kept={kept}
          removed={removed}
          added={added}
          cities={CITIES.filter(
            (c) => (selections[c.id] ?? []).some((id) => !review.removed.includes(id)) || (review.added?.[c.id]?.length ?? 0) > 0,
          ).map((c) => c.label)}
          onCancel={() => setConfirming(false)}
          onApprove={async (name, note) => {
            const ok = await onApprove(name, note);
            if (ok) setConfirming(false);
            return ok;
          }}
        />
      )}
    </>
  );
}

function ApproveDialog({
  kept,
  removed,
  added,
  cities,
  onCancel,
  onApprove,
}: {
  kept: number;
  removed: number;
  added: number;
  cities: string[];
  onCancel: () => void;
  onApprove: (name: string, note: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await onApprove(name.trim(), note.trim());
    if (!ok) {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <div className="review-dialog-overlay" onClick={() => !busy && onCancel()}>
      <div className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="review-dialog-title">Approve your shortlist</h2>
        <p className="review-dialog-summary">
          You're approving <strong>{kept}</strong> {kept === 1 ? "property" : "properties"}
          {removed > 0 || added > 0 ? ` (${[removed > 0 && `${removed} removed`, added > 0 && `${added} added`].filter(Boolean).join(", ")})` : ""}
          {cities.length > 0 ? ` in ${cities.join(", ")}` : ""}. The Adonmo team will see your choices and comments.
        </p>
        <label className="review-dialog-field">
          Your name <span>(optional)</span>
          <input type="text" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
        </label>
        <label className="review-dialog-field">
          Anything else for the team? <span>(optional)</span>
          <textarea value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="Start date, budget, questions…" />
        </label>
        {failed && <p className="review-dialog-error">Couldn't approve — check your connection and try again.</p>}
        <div className="review-dialog-actions">
          <button type="button" className="review-bar-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="review-bar-primary" disabled={busy} onClick={submit}>
            {busy ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
