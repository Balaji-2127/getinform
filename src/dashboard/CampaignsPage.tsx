import { useEffect, useState } from "react";
import MapExperience from "../MapExperience";
import ClientLogo from "./ClientLogo";
import { ExpandIcon } from "./icons";
import { CITIES, type CityId } from "../data/cities";
import "./CampaignsPage.css";

type CampaignResponse = { clientName: string; campaignName: string; selections: Record<string, string[]> };

function firstCityWithSelection(selections: Record<string, string[]>): CityId {
  const match = CITIES.find((c) => (selections[c.id]?.length ?? 0) > 0);
  return match?.id ?? CITIES[0].id;
}

// Empty until an actual campaign has been uploaded this session — no
// generic "browse everything" placeholder data (that lives on the
// Inventory tab now). Once a campaign is active, this embeds the exact
// same MapExperience the client-facing shareable link uses — same
// highlighting, same "shortlisted properties always shown individually"
// rule, same guided tour — just inside this dashboard's own bounded panel
// instead of full-screen (position:absolute + inset:0 fills whichever
// positioned ancestor it's given). hideBrand suppresses its floating
// "ADONMO" logo block, which is redundant next to the dashboard shell's
// own branding/nav — the city-switch buttons themselves still show
// whenever a campaign spans more than one city, since that's the only way
// to see each city's highlighted properties in this embedded view.
export default function CampaignsPage({
  activeCampaignId,
  onGoUpload,
}: {
  activeCampaignId: string | null;
  onGoUpload: () => void;
}) {
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CampaignResponse }
  >({ status: "idle" });

  // The no-login, full-screen link a client opens to see just their own
  // shortlisted properties (ClientCampaignView, via App.tsx's /campaign/:id
  // route) — UploadCampaign already surfaces this once, right after a
  // fresh upload, but there was no way to get back to it for a campaign
  // reopened later from Dashboard/Clients/Reports history. Deterministic
  // from the campaign id alone, so it's available the moment one's loaded.
  const [copied, setCopied] = useState(false);
  const shareLink = activeCampaignId ? `${window.location.origin}/campaign/${activeCampaignId}` : null;

  useEffect(() => {
    setCopied(false);
  }, [activeCampaignId]);

  // Portal target for GoogleInventoryMap's CampaignBanner (tour control +
  // stats) — a plain state setter used as the ref callback so the portal
  // has something to render into as soon as this div mounts, instead of
  // the banner floating over the map itself.
  const [bannerSlot, setBannerSlot] = useState<HTMLDivElement | null>(null);

  // The embedded map frame defaults to a bounded panel (matches the rest
  // of this dashboard page) — fullscreen expands it to cover the whole
  // viewport for actually presenting it to a client, with Escape or the
  // same button as a way back out.
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!activeCampaignId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/campaigns/${activeCampaignId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Campaign not found");
        }
        return res.json() as Promise<CampaignResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ status: "error", message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [activeCampaignId]);

  return (
    <div className="cpg-page">
      <div className="cpg-header">
        <div>
          <span className="cpg-eyebrow">CAMPAIGN PLANNING</span>
          <h1>Find the Right Screens for Your Campaign</h1>
          <p>
            {state.status === "ready"
              ? `Showing "${state.data.clientName} — ${state.data.campaignName}" — the client's shortlisted properties, highlighted.`
              : "Upload a shortlist to see the highlighted results here."}
          </p>
        </div>
        {state.status === "ready" && (
          <div className="cpg-header-actions-group">
            <button
              type="button"
              className="cpg-copy-link-btn"
              onClick={() => {
                if (shareLink) navigator.clipboard.writeText(shareLink).then(() => setCopied(true));
              }}
              title={shareLink ?? undefined}
            >
              {copied ? "✓ Copied" : "🔗 Copy client link"}
            </button>
            <ClientLogo clientName={state.data.clientName} />
          </div>
        )}
      </div>

      {state.status === "ready" && <div ref={setBannerSlot} className="cpg-banner-row" />}

      {state.status === "idle" && (
        <div className="cpg-empty">
          <p>No campaign loaded yet.</p>
          <button type="button" className="cpg-empty-btn" onClick={onGoUpload}>
            Upload a campaign sheet
          </button>
        </div>
      )}

      {state.status === "loading" && (
        <div className="cpg-empty">
          <p>Loading campaign…</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="cpg-empty cpg-empty-error">
          <p>{state.message}</p>
          <button type="button" className="cpg-empty-btn" onClick={onGoUpload}>
            Try uploading again
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <div className={"cpg-map-frame" + (fullscreen ? " is-fullscreen" : "")}>
          <button
            type="button"
            className="cpg-fullscreen-btn"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? "Exit fullscreen" : "Expand to fullscreen"}
          >
            {fullscreen ? "✕ Exit fullscreen" : (
              <>
                <ExpandIcon size={14} /> Fullscreen
              </>
            )}
          </button>
          <MapExperience
            initialCity={firstCityWithSelection(state.data.selections)}
            campaign={{
              label: `${state.data.clientName} — ${state.data.campaignName}`,
              brand: state.data.clientName.toUpperCase(),
              clientName: state.data.clientName,
              selections: state.data.selections,
            }}
            hideBrand
            bannerPortalTarget={bannerSlot}
          />
        </div>
      )}
    </div>
  );
}
