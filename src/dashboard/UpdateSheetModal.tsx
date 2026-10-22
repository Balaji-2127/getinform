import { useState } from "react";
import { CITIES } from "../data/cities";
import { MAX_SHEET_BYTES, SHEET_TOO_LARGE } from "../uploadLimit";
import { useToast } from "./Toast";
import { CloseIcon, UploadIcon } from "./icons";
import "./UpdateSheetModal.css";

type UpdateResult = {
  mode: "merge" | "replace";
  added: number;
  newCities: string[];
  before: Record<string, number>;
  after: Record<string, number>;
  matched: Record<string, number>;
  skippedSheets: string[];
  warnings: string[];
  selections: Record<string, string[]>;
};

function cityLabel(cityId: string): string {
  return CITIES.find((c) => c.id === cityId)?.label ?? cityId;
}

// Grows an existing campaign from an updated sheet, instead of making a
// second campaign for the same pitch.
//
// The case this is for: a campaign was built from a two-city sheet and the
// client now wants two more cities. Creating a new campaign would split one
// pitch across two share links and leave the client holding the older,
// smaller one. Re-uploading here keeps the same campaign and the same link —
// it just covers more.
export default function UpdateSheetModal({
  campaignId,
  currentSelections,
  onClose,
  onUpdated,
}: {
  campaignId: string;
  currentSelections: Record<string, string[]>;
  onClose: () => void;
  onUpdated: (selections: Record<string, string[]>) => void;
}) {
  const showToast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [result, setResult] = useState<UpdateResult | null>(null);

  const currentCities = CITIES.filter((c) => (currentSelections[c.id]?.length ?? 0) > 0);
  const currentTotal = Object.values(currentSelections).reduce((n, ids) => n + ids.length, 0);

  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_SHEET_BYTES) {
      setError(SHEET_TOO_LARGE);
      return;
    }
    setBusy(true);
    setError(null);
    setErrorDetails([]);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("mode", mode);
      const res = await fetch(`/api/campaigns/${campaignId}/upload`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not update the campaign");
        setErrorDetails(Array.isArray(data?.warnings) ? data.warnings : []);
        return;
      }
      const updated = data as UpdateResult;
      setResult(updated);
      // The map behind this modal redraws immediately; the result stays on
      // screen so the per-city numbers and any warnings can actually be read
      // before closing.
      onUpdated(updated.selections);
      showToast(updated.added > 0 ? `${updated.added} properties added` : "Campaign updated");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="usm-overlay" onClick={() => !busy && onClose()}>
      <div className="usm-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="usm-header">
          <h2>Update campaign sheet</h2>
          <button type="button" className="usm-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </div>

        {!result && (
          <>
            <p className="usm-current">
              Currently {currentTotal.toLocaleString()} properties across{" "}
              {currentCities.length > 0 ? currentCities.map((c) => c.label).join(", ") : "no cities yet"}.
            </p>

            <label className="usm-file">
              <span className="usm-label">Updated sheet (.xlsx)</span>
              <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>

            <div className="usm-modes">
              <label className={"usm-mode" + (mode === "merge" ? " is-on" : "")}>
                <input type="radio" name="usm-mode" checked={mode === "merge"} onChange={() => setMode("merge")} />
                <span>
                  <strong>Add to this campaign</strong>
                  <small>Keeps everything already shortlisted and adds whatever is new in the sheet, including new cities.</small>
                </span>
              </label>
              <label className={"usm-mode" + (mode === "replace" ? " is-on" : "")}>
                <input type="radio" name="usm-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span>
                  <strong>Replace the shortlist</strong>
                  <small>The sheet becomes the whole campaign. Anything not in it is removed.</small>
                </span>
              </label>
            </div>

            {error && (
              <div className="usm-error">
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

            <div className="usm-actions">
              <button type="button" className="usm-cancel btn btn-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="usm-submit btn btn-primary" onClick={submit} disabled={busy || !file}>
                {busy ? "Updating…" : (
                  <>
                    <UploadIcon size={14} /> {mode === "replace" ? "Replace shortlist" : "Add to campaign"}
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {result && (
          <div className="usm-result">
            <p className="usm-result-headline">
              {result.added > 0
                ? `${result.added.toLocaleString()} ${result.added === 1 ? "property" : "properties"} added.`
                : "No new properties — everything in that sheet was already shortlisted."}
            </p>
            {result.newCities.length > 0 && (
              <p className="usm-result-cities">
                New {result.newCities.length === 1 ? "city" : "cities"}: {result.newCities.map(cityLabel).join(", ")}
              </p>
            )}

            <ul className="usm-breakdown">
              {Object.keys(result.after).map((city) => {
                const before = result.before[city] ?? 0;
                const after = result.after[city];
                return (
                  <li key={city}>
                    <span>{cityLabel(city)}</span>
                    <span className="usm-count">
                      {before === after ? (
                        `${after} properties`
                      ) : (
                        <>
                          {before} <span className="usm-arrow">→</span> <strong>{after}</strong>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {result.skippedSheets.length > 0 && (
              <p className="usm-note">Sheets not recognised and skipped: {result.skippedSheets.join(", ")}</p>
            )}
            {result.warnings.length > 0 && (
              <ul className="usm-warnings">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <div className="usm-actions">
              <button type="button" className="usm-submit btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
