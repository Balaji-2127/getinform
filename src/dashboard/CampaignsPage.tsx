import { useEffect, useMemo, useRef, useState } from "react";
import MapExperience from "../MapExperience";
import ClientLogo from "./ClientLogo";
import { CheckIcon, CloseIcon, ExpandIcon, ExportIcon, LinkIcon, PencilIcon, UploadIcon } from "./icons";
import { CITIES, type CityId } from "../data/cities";
import EditShortlistModal from "./EditShortlistModal";
import UpdateSheetModal from "./UpdateSheetModal";
import { copyToClipboard } from "../copyToClipboard";
import { useToast } from "./Toast";
import ClientFeedback from "./ClientFeedback";
import type { CampaignReview, MapReview } from "../review";
import "./CampaignsPage.css";

type CampaignResponse = {
  clientName: string;
  campaignName: string;
  selections: Record<string, string[]>;
  review: CampaignReview | null;
};

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
// own branding/nav. citySwitcherPortalTarget pulls the multi-city picker
// off the map entirely too — instead of a button list floating over it,
// it's a plain dropdown sitting in the stats row below, still the only
// way to see each city's highlighted properties when a campaign spans
// more than one.
export default function CampaignsPage({
  activeCampaignId,
  onGoUpload,
}: {
  activeCampaignId: string | null;
  onGoUpload: () => void;
}) {
  const showToast = useToast();
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CampaignResponse }
  >({ status: "idle" });
  const [showEdit, setShowEdit] = useState(false);
  const [showUpdateSheet, setShowUpdateSheet] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

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
  // Same idea for the multi-city dropdown — sits right beside the stats
  // row instead of floating a city-button list over the map itself.
  const [citySwitcherSlot, setCitySwitcherSlot] = useState<HTMLDivElement | null>(null);

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

  // Bumped by the client-feedback panel's Refresh, to pick up anything the
  // client has done on their link since this page loaded.
  const [reloadCount, setReloadCount] = useState(0);
  const loadedIdRef = useRef<string | null>(null);

  // The client may be editing their link right now: re-read the campaign
  // every half minute while this tab is in view, so their requests show
  // up here without anyone pressing Refresh. Only changed data re-renders
  // anything, so the map isn't disturbed.
  useEffect(() => {
    if (!activeCampaignId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setReloadCount((n) => n + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeCampaignId]);

  useEffect(() => {
    if (!activeCampaignId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    // A refresh keeps the map on screen; only a different campaign shows
    // the loading state.
    if (loadedIdRef.current !== activeCampaignId) setState({ status: "loading" });
    fetch(`/api/campaigns/${activeCampaignId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Campaign not found");
        }
        return res.json() as Promise<CampaignResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        loadedIdRef.current = activeCampaignId;
        // Same data as before: keep the old object so nothing re-renders.
        setState((prev) => (prev.status === "ready" && JSON.stringify(prev.data) === JSON.stringify(data) ? prev : { status: "ready", data }));
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ status: "error", message: e.message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaignId, reloadCount]);

  // The client's choices drawn on the team's map too — removed properties
  // in red, and their comment in the property panel — read-only here.
  const review = state.status === "ready" ? state.data.review : null;
  const mapReview: MapReview | undefined = useMemo(
    () =>
      review
        ? { removed: new Set(review.removed), added: new Set(Object.values(review.added ?? {}).flat()), comments: review.comments, audience: "team" }
        : undefined,
    [review],
  );

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
            <button type="button" className="cpg-copy-link-btn" onClick={() => setShowEdit(true)}>
              <PencilIcon size={14} /> Edit shortlist
            </button>
            <button type="button" className="cpg-copy-link-btn" onClick={() => setShowUpdateSheet(true)}>
              <UploadIcon size={14} /> Update sheet
            </button>
            <button
              type="button"
              className="cpg-copy-link-btn"
              disabled={pdfBusy}
              onClick={async () => {
                if (state.status !== "ready") return;
                setPdfBusy(true);
                try {
                  // Dynamic import: jsPDF (and the html2canvas it pulls in
                  // unconditionally, unused here) is sizeable — loading it
                  // only when someone actually clicks this button keeps it
                  // out of the main bundle every other page pays for.
                  const { downloadCampaignPdf } = await import("./campaignPdf");
                  await downloadCampaignPdf(state.data.clientName, state.data.campaignName, state.data.selections, shareLink, activeCampaignId);
                  showToast("PDF downloaded");
                } catch {
                  showToast("Could not generate PDF — try again", "error");
                } finally {
                  setPdfBusy(false);
                }
              }}
            >
              {pdfBusy ? (
                "Preparing…"
              ) : (
                <>
                  <ExportIcon size={14} /> Download PDF
                </>
              )}
            </button>
            <button
              type="button"
              className="cpg-copy-link-btn"
              onClick={async () => {
                if (!shareLink) return;
                if (await copyToClipboard(shareLink)) {
                  setCopied(true);
                  // Revert the label so the button reads as a button again
                  // rather than being stuck on "Copied" for the rest of the
                  // session (it only used to reset on a campaign switch).
                  setTimeout(() => setCopied(false), 2000);
                  showToast("Client link copied");
                } else {
                  showToast("Couldn't copy — the link is in this button's tooltip", "error");
                }
              }}
              title={shareLink ?? undefined}
            >
              {copied ? (
                <>
                  <CheckIcon size={14} /> Copied
                </>
              ) : (
                <>
                  <LinkIcon size={14} /> Copy client link
                </>
              )}
            </button>
            <ClientLogo clientName={state.data.clientName} />
          </div>
        )}
      </div>

      {state.status === "ready" && (
        <div className="cpg-banner-row">
          <div ref={setCitySwitcherSlot} className="cpg-city-switcher-slot" />
          <div ref={setBannerSlot} className="cpg-banner-slot" />
        </div>
      )}

      {state.status === "ready" && activeCampaignId && (
        <ClientFeedback
          campaignId={activeCampaignId}
          selections={state.data.selections}
          review={state.data.review}
          onApplied={({ selections, review }) => setState({ status: "ready", data: { ...state.data, selections, review } })}
          onRefresh={() => setReloadCount((n) => n + 1)}
        />
      )}

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
            {fullscreen ? (
              <>
                <CloseIcon size={14} /> Exit fullscreen
              </>
            ) : (
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
            citySwitcherPortalTarget={citySwitcherSlot}
            review={mapReview}
          />
        </div>
      )}

      {showUpdateSheet && state.status === "ready" && activeCampaignId && (
        <UpdateSheetModal
          campaignId={activeCampaignId}
          currentSelections={state.data.selections}
          onClose={() => setShowUpdateSheet(false)}
          onUpdated={(selections) => {
            // Updates in place rather than closing: the map behind redraws
            // straight away, and the modal keeps showing the per-city
            // before/after numbers so they can actually be read.
            setState({ status: "ready", data: { ...state.data, selections } });
          }}
        />
      )}

      {showEdit && state.status === "ready" && activeCampaignId && (
        <EditShortlistModal
          campaignId={activeCampaignId}
          initialSelections={state.data.selections}
          onClose={() => setShowEdit(false)}
          onSaved={(selections) => {
            setState({ status: "ready", data: { ...state.data, selections } });
            setShowEdit(false);
          }}
        />
      )}
    </div>
  );
}
