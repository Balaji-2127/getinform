import { useState } from "react";
import { useToast } from "./Toast";
import "./DeleteCampaignDialog.css";

export type DeletableCampaign = {
  id: string;
  clientName: string;
  campaignName: string;
  properties: number;
};

// Shared by Reports and Clients — both list campaigns, so both offer to
// delete one, and a destructive confirmation is exactly the thing that must
// not drift between two copies.
//
// Deleting is irreversible and breaks any client link already sent out, so
// this names the campaign and says what will happen rather than firing on a
// single click in a list where rows look alike.
export default function DeleteCampaignDialog({
  campaign,
  onCancel,
  onDeleted,
}: {
  campaign: DeletableCampaign;
  onCancel: () => void;
  // Fires only after the server confirms the delete, so a caller can drop it
  // from its own list without optimistically removing something that is
  // still there.
  onDeleted: (campaignId: string) => void;
}) {
  const showToast = useToast();
  const [deleting, setDeleting] = useState(false);

  const confirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      onDeleted(campaign.id);
      showToast("Campaign deleted");
    } catch {
      showToast("Couldn't delete that campaign — try again", "error");
      setDeleting(false);
    }
  };

  return (
    <div className="rdl-overlay" onClick={() => !deleting && onCancel()}>
      <div className="rdl-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h2>Delete this campaign?</h2>
        <p className="rdl-target">
          <strong>{campaign.clientName}</strong> — {campaign.campaignName}
          <span className="rdl-meta">{campaign.properties.toLocaleString()} properties shortlisted</span>
        </p>
        <p className="rdl-warn">
          This permanently removes it from the database. Any client link you've already shared for this campaign will stop
          working, and it can't be undone.
        </p>
        <div className="rdl-actions">
          <button type="button" className="rdl-cancel" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="rdl-confirm" onClick={confirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
