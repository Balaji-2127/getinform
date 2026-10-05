import ClientLogo from "./dashboard/ClientLogo";
import "./CampaignBanner.css";

export type CampaignSummary = {
  label: string;
  pointCount: number;
  totalScreens: number;
  totalHouseholds: number;
  totalImpressions: number;
  totalAdBudget: number;
};

// Always-visible headline for a campaign view — separate from the
// breadcrumb-driven InspectorPanel (which only appears once something's
// selected) so a client opening the link immediately sees whose campaign
// this is and its topline numbers, before they've clicked anything.
//
// The dashboard's embedded view renders this same component but portals it
// out of the map entirely, into a slot the page provides above the map
// frame (see GoogleInventoryMap's bannerPortalTarget / CampaignsPage's
// banner slot) — that page already states the campaign name in its own
// header, so `inline` mode drops the redundant name/badge and keeps just
// the tour control + stats, laid out to sit in a normal document flow row
// instead of floating. The full-screen client-facing link has no such
// header to defer to, so it keeps the floating, self-contained version.
export default function CampaignBanner({
  summary,
  touring,
  tourProgress,
  tourPause,
  onStartTour,
  onResumeTour,
  onStopTour,
  inline,
  clientName,
}: {
  summary: CampaignSummary | null;
  touring: boolean;
  tourProgress: { current: number; total: number } | null;
  // Set once a tour's been interrupted mid-run (Stop, or navigating away)
  // — offers Resume alongside Restart instead of just one Start button,
  // until the tour is resumed or runs to its natural end.
  tourPause: { index: number; total: number } | null;
  onStartTour: () => void;
  onResumeTour: () => void;
  onStopTour: () => void;
  inline?: boolean;
  // The client's own brand logo (resolved the same way the dashboard's
  // Campaigns page already shows it — by name, via Gemini + a favicon
  // lookup) — only used in the floating/overlay variant, in place of the
  // generic "Campaign" badge, so a client opening their link sees their
  // own brand immediately. Dropped in `inline` mode since the dashboard
  // already shows it separately in its own page header; passing it there
  // is harmless either way.
  clientName?: string;
}) {
  if (!summary) return null;

  const tourControl = touring ? (
    <button type="button" className="campaign-banner-tour" onClick={onStopTour}>
      {`■ Stop tour (${tourProgress?.current ?? 0}/${tourProgress?.total ?? 0})`}
    </button>
  ) : tourPause ? (
    <div className="campaign-banner-tour-group">
      <button type="button" className="campaign-banner-tour campaign-banner-tour-ghost" onClick={onStartTour}>
        ↻ Restart
      </button>
      <button type="button" className="campaign-banner-tour" onClick={onResumeTour}>
        {`▶ Resume (${tourPause.index + 1}/${tourPause.total})`}
      </button>
    </div>
  ) : (
    <button type="button" className="campaign-banner-tour" onClick={onStartTour}>
      ▶ Tour the shortlist
    </button>
  );

  const stats = (
    <div className="campaign-banner-stats">
      <Stat label="Properties" value={summary.pointCount.toLocaleString()} />
      <Stat label="Screens" value={summary.totalScreens.toLocaleString()} />
      <Stat label="Households" value={summary.totalHouseholds.toLocaleString()} />
      <Stat label="Ad budget/mo" value={`₹${summary.totalAdBudget.toLocaleString()}`} />
    </div>
  );

  if (inline) {
    return (
      <div className="campaign-banner campaign-banner-inline">
        {tourControl}
        {stats}
      </div>
    );
  }

  return (
    <div className="campaign-banner">
      <div className="campaign-banner-heading">
        {clientName ? <ClientLogo clientName={clientName} /> : <span className="campaign-banner-badge">Campaign</span>}
        <h1>{summary.label}</h1>
        {tourControl}
      </div>
      {stats}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="campaign-banner-stat">
      <span className="campaign-banner-stat-value">{value}</span>
      <span className="campaign-banner-stat-label">{label}</span>
    </div>
  );
}
