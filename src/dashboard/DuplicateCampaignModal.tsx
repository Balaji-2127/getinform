import { useState } from "react";
import "./EditShortlistModal.css";

// Reuses an existing campaign's shortlist as the starting point for a new
// one (a repeat for the same client, or a similar campaign for a new
// one) — same selections, just a fresh client/campaign name, instead of
// re-uploading or re-picking a sheet from scratch. Shares the generic
// .esm-* overlay/card styling with EditShortlistModal rather than
// duplicating it for a form this small.
export default function DuplicateCampaignModal({
  sourceCampaignId,
  defaultClientName,
  onClose,
  onDuplicated,
}: {
  sourceCampaignId: string;
  defaultClientName: string;
  onClose: () => void;
  onDuplicated: (campaignId: string) => void;
}) {
  const [clientName, setClientName] = useState(defaultClientName);
  const [campaignName, setCampaignName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !campaignName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${sourceCampaignId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: clientName.trim(), campaignName: campaignName.trim() }),
      });
      if (!res.ok) throw new Error("Could not duplicate campaign");
      const data = (await res.json()) as { campaignId: string };
      onDuplicated(data.campaignId);
    } catch {
      setError("Could not duplicate this campaign — try again.");
      setSaving(false);
    }
  };

  return (
    <div className="esm-overlay" onClick={onClose}>
      <div className="esm-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "none" }}>
        <div className="esm-header">
          <h2>Duplicate campaign</h2>
          <button type="button" className="esm-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="esm-sub">Reuses this campaign's exact shortlist under a new client/campaign name.</p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10, fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
            Client name
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Licious"
              required
              style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#111827" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4, fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
            Campaign name
            <input
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. Bengaluru launch, round 2"
              required
              style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontFamily: "inherit", color: "#111827" }}
            />
          </label>

          {error && <p className="esm-error">{error}</p>}

          <div className="esm-actions">
            <button type="button" className="esm-cancel-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="esm-save-btn" disabled={saving}>
              {saving ? "Duplicating…" : "Duplicate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
