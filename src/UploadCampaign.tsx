import { useEffect, useState } from "react";
import { CITIES } from "./data/cities";
import { copyToClipboard } from "./copyToClipboard";
import { MAX_SHEET_BYTES, SHEET_TOO_LARGE } from "./uploadLimit";
import { ArrowRightIcon } from "./dashboard/icons";
import { useToast } from "./dashboard/Toast";
import "./UploadCampaign.css";

type UploadResult = {
  campaignId: string;
  shareUrl: string;
  matched: Record<string, number>;
  skippedSheets: string[];
  warnings: string[];
};

type CampaignListItem = {
  id: string;
  clientName: string;
  campaignName: string;
  createdAt: string;
  counts: Record<string, number>;
};

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

export default function UploadCampaign({
  onCampaignCreated,
}: {
  // Optional: fires with the new campaign's id right after a successful
  // upload (and when opening a past campaign from the list below), so an
  // embedding parent — the dashboard's Campaigns page — can switch to
  // showing it immediately instead of only handing back a shareable link.
  onCampaignCreated?: (campaignId: string) => void;
}) {
  const showToast = useToast();
  const [clientName, setClientName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [pastCampaigns, setPastCampaigns] = useState<CampaignListItem[] | null>(null);

  const loadPastCampaigns = () => {
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: CampaignListItem[]) => setPastCampaigns(list))
      .catch(() => setPastCampaigns([]));
  };

  useEffect(() => {
    loadPastCampaigns();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_SHEET_BYTES) {
      setError(SHEET_TOO_LARGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    setErrorDetails([]);
    setResult(null);
    setCopied(false);
    try {
      const body = new FormData();
      body.append("clientName", clientName);
      body.append("campaignName", campaignName);
      body.append("file", file);
      const res = await fetch("/api/campaigns/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Upload failed");
        setErrorDetails(Array.isArray(data?.warnings) ? data.warnings : []);
        return;
      }
      const uploadResult = data as UploadResult;
      setResult(uploadResult);
      loadPastCampaigns();
      // The server reports per-sheet problems that still left a usable
      // campaign behind (a sheet it didn't recognize, or one whose rows
      // matched no known inventory — see parseWorkbook's `warnings`).
      // Jumping straight to the embedded campaign view unmounts this page
      // and threw all of that away unread, which defeats the point of the
      // server sending it. So: navigate immediately only on a clean
      // upload, and otherwise stay here with the result panel showing
      // what went wrong plus its own button to carry on.
      const hasNotices = (uploadResult.warnings?.length ?? 0) > 0 || (uploadResult.skippedSheets?.length ?? 0) > 0;
      if (hasNotices) {
        showToast("Campaign created, but some sheets need a look", "error");
      } else {
        onCampaignCreated?.(uploadResult.campaignId);
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  };

  const shareLink = result ? `${window.location.origin}${result.shareUrl}` : null;

  return (
    <div className="upload-page">
      <div className="upload-header">
        <span className="upload-eyebrow">CAMPAIGN UPLOAD</span>
        <h1>New campaign</h1>
        <p className="upload-sub">
          Upload the master inventory sheet with unwanted property rows deleted — matched rows are looked up by
          their Media Site Id.
        </p>
      </div>

      <div className="upload-body">
        <div className="upload-card">
          <form onSubmit={handleSubmit} className="upload-form">
            <label>
              Client name
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Licious" required />
            </label>
            <label>
              Campaign name
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Bengaluru launch"
                required
              />
            </label>
            <label>
              Shortlisted properties (.xlsx)
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
            </label>

            {error && (
              <div className="upload-error">
                <p>{error}</p>
                {errorDetails.length > 0 && (
                  <ul>
                    {errorDetails.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button type="submit" disabled={submitting || !file}>
              {submitting ? "Uploading…" : "Upload & generate link"}
            </button>
          </form>

          {result && (
            <div className="upload-result">
              <p className="upload-result-title">Campaign created</p>
              <div className="upload-share-row">
                <input readOnly value={shareLink ?? ""} onFocus={(e) => e.currentTarget.select()} />
                <button
                  type="button"
                  onClick={async () => {
                    if (!shareLink) return;
                    if (await copyToClipboard(shareLink)) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                      showToast("Client link copied");
                    } else {
                      showToast("Couldn't copy — select the link above and copy it manually", "error");
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <ul className="upload-matched">
                {Object.entries(result.matched).map(([city, count]) => (
                  <li key={city}>
                    {cityLabel(city)}: {count} {count === 1 ? "property" : "properties"} matched
                  </li>
                ))}
              </ul>
              {result.skippedSheets.length > 0 && (
                <p className="upload-skipped">
                  Skipped sheets not yet supported on the map: {result.skippedSheets.join(", ")}
                </p>
              )}
              {result.warnings.length > 0 && (
                <ul className="upload-warnings">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <div className="upload-result-actions">
                {onCampaignCreated && (
                  <button type="button" className="upload-open-btn" onClick={() => onCampaignCreated(result.campaignId)}>
                    Open in Campaigns <ArrowRightIcon size={13} />
                  </button>
                )}
                <a className="upload-preview-link" href={result.shareUrl} target="_blank" rel="noreferrer">
                  Preview the highlighted map <ArrowRightIcon size={13} />
                </a>
              </div>
            </div>
          )}
        </div>

        {pastCampaigns && pastCampaigns.length > 0 && (
          <div className="upload-card upload-history">
            <h2>Past campaigns</h2>
            <ul>
              {pastCampaigns.slice(0, 10).map((c) => (
                <li key={c.id}>
                  <div>
                    <span className="upload-history-client">{c.clientName}</span>
                    <span className="upload-history-name"> · {c.campaignName}</span>
                  </div>
                  <button type="button" onClick={() => onCampaignCreated?.(c.id)}>
                    Open <ArrowRightIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
