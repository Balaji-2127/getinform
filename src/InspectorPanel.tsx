import { useEffect, useState, type ReactNode } from "react";
import "./InspectorPanel.css";
import type { SyntheticScreen } from "./syntheticScreens";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CloseIcon, PlusIcon } from "./dashboard/icons";
import type { MapReview } from "./review";

// The review controls for the one property this panel is showing.
// `inShortlist`: one the sales team shortlisted (Keep / Remove), as opposed
// to the rest of the inventory (Add to my shortlist).
type PropertyReview = MapReview & { mediaSiteId: string; cityId: string; inShortlist: boolean };

// Despite the name, this isn't rendered as a UI "cluster" view anymore —
// the map draws every property as its own pin now, never grouped behind a
// cluster bubble. Kept only because GoogleInventoryMap's
// summarizeClusterLeaves still uses this shape to aggregate a campaign's
// shortlisted properties into one summary (CampaignBanner's stat row).
export type ClusterInfo = {
  pointCount: number;
  totalScreens: number;
  totalHouseholds: number;
  totalImpressions: number;
  totalAdBudget: number;
  dailyFootfall: number;
  localities: { name: string; count: number }[];
  moreLocalities: number;
  zones: { name: string; count: number }[];
};

export type ProjectPanelInfo = {
  name: string;
  locality: string | null;
  zone: string | null;
  totalScreens: number;
  households: number | null;
  impressionsPerMonth: number | null;
  monthlyAdBudget: number | null;
  dailyFootfall: number | null;
  screenSizes: string[];
  screenList: SyntheticScreen[];
  hiddenScreenCount: number;
  visualLink: string | null;
};

export type ViewLevel = "city" | "project" | "screen";

type Content =
  | { kind: "project"; project: ProjectPanelInfo }
  | { kind: "screen"; screen: SyntheticScreen; project: ProjectPanelInfo };

type Crumb = { label: string; level: ViewLevel };

export default function InspectorPanel({
  content,
  crumbs,
  onNavigate,
  onClose,
  review,
}: {
  content: Content | null;
  crumbs: Crumb[];
  onNavigate: (level: ViewLevel) => void;
  onClose: () => void;
  // Only for a property on the campaign's shortlist.
  review?: PropertyReview;
}) {
  if (!content) return null;

  return (
    <div className="inspector-panel">
      <button type="button" className="inspector-back-all" onClick={onClose}>
        <ArrowLeftIcon size={14} /> Back to all properties
      </button>

      {crumbs.length > 1 && (
        <nav className="inspector-breadcrumb" aria-label="Inventory drill-down path">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={c.level} className="inspector-breadcrumb-item">
                {isLast ? (
                  <span className="inspector-breadcrumb-current">{c.label}</span>
                ) : (
                  <button type="button" className="inspector-breadcrumb-link" onClick={() => onNavigate(c.level)}>
                    {c.label}
                  </button>
                )}
                {!isLast && <span className="inspector-breadcrumb-sep">›</span>}
              </span>
            );
          })}
        </nav>
      )}

      {content.kind === "project" && (
        <ProjectView project={content.project} review={review ? <ReviewBlock key={review.mediaSiteId} review={review} /> : null} />
      )}
      {content.kind === "screen" && (
        <ScreenView screen={content.screen} project={content.project} onNavigate={onNavigate} />
      )}
    </div>
  );
}

// Splits a project's true total screen count evenly across its distinct
// screen sizes (e.g. 11 screens across two sizes -> 6 + 5) — the closest
// honest breakdown available, since the source data only tracks a total
// count and a list of size types per project, never a real per-size count.
function screenSizeCounts(total: number, sizes: string[]): { size: string; count: number }[] {
  if (sizes.length === 0 || total === 0) return [];
  const base = Math.floor(total / sizes.length);
  const remainder = total % sizes.length;
  return sizes.map((size, i) => ({ size, count: base + (i < remainder ? 1 : 0) }));
}

function ProjectView({ project, review }: { project: ProjectPanelInfo; review: ReactNode }) {
  return (
    <>
      <header className="inspector-header">
        <h2>{project.name}</h2>
        <p className="inspector-sub">
          {project.locality ?? "—"}
          {project.zone ? ` · ${project.zone}` : ""}
        </p>
      </header>

      {review}

      <PropertyImages project={project} />

      {project.visualLink && (
        <a className="inspector-photos-link" href={project.visualLink} target="_blank" rel="noreferrer">
          View property photos <ArrowRightIcon size={13} />
        </a>
      )}

      <div className="inspector-stats">
        <Stat label="Screens" value={project.totalScreens.toLocaleString()} />
        <Stat label="Households" value={project.households?.toLocaleString() ?? "—"} />
        <Stat label="Impressions/mo" value={project.impressionsPerMonth?.toLocaleString() ?? "—"} />
        <Stat label="Est. daily footfall" value={project.dailyFootfall?.toLocaleString() ?? "—"} />
        <Stat
          label="Ad budget/mo"
          value={project.monthlyAdBudget ? `₹${project.monthlyAdBudget.toLocaleString()}` : "—"}
          wide
        />
      </div>

      <Section title={`Screens (${project.totalScreens})`}>
        {project.totalScreens === 0 ? (
          <Empty text="No screens recorded for this project" />
        ) : (
          <ul className="inspector-list">
            {screenSizeCounts(project.totalScreens, project.screenSizes).map((row) => (
              <li key={row.size}>
                <span>{row.size}</span>
                <span className="inspector-count">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// How long typing has to pause before a comment is saved. Blurring the box
// saves straight away, so nothing typed is lost by clicking elsewhere.
const COMMENT_SAVE_DELAY_MS = 800;

// Keep / Remove and a comment box on the client's link; on the sales team's
// view, the client's choice and comment shown read-only.
function ReviewBlock({ review }: { review: PropertyReview }) {
  const { mediaSiteId } = review;
  const removed = review.removed.has(mediaSiteId);
  const added = review.added.has(mediaSiteId);
  const saved = review.comments[mediaSiteId] ?? "";
  const [draft, setDraft] = useState(saved);
  const editable = review.audience === "client" && Boolean(review.onSetRemoved);

  const commit = () => {
    if (draft.trim() !== saved) review.onComment?.(mediaSiteId, draft);
  };

  useEffect(() => {
    if (!editable || draft.trim() === saved) return;
    const timer = window.setTimeout(() => review.onComment?.(mediaSiteId, draft), COMMENT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // The rest of Adonmo's inventory: the client can add it to their shortlist.
  if (!review.inShortlist) {
    if (!editable) {
      if (!added) return null;
      return (
        <div className="inspector-review is-added">
          <span className="inspector-review-title">Client's review</span>
          <p className="inspector-review-verdict">Client added this property</p>
          {saved && <blockquote className="inspector-review-comment">{saved}</blockquote>}
        </div>
      );
    }
    return (
      <div className={"inspector-review" + (added ? " is-added" : " is-inventory")}>
        <span className="inspector-review-title">{added ? "Added to your shortlist" : "Not in your shortlist"}</span>
        {added ? (
          <button
            type="button"
            className="inspector-review-btn"
            disabled={review.locked}
            onClick={() => review.onSetAdded?.(review.cityId, mediaSiteId, false)}
          >
            <CloseIcon size={13} /> Remove from my shortlist
          </button>
        ) : (
          <button
            type="button"
            className="inspector-review-btn is-add"
            disabled={review.locked}
            onClick={() => review.onSetAdded?.(review.cityId, mediaSiteId, true)}
          >
            <PlusIcon size={13} /> Add to my shortlist
          </button>
        )}
        {added && (
          <textarea
            className="inspector-review-input"
            placeholder="Add a comment for the Adonmo team (optional)"
            value={draft}
            maxLength={1000}
            rows={2}
            disabled={review.locked}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
        )}
        {review.locked && <p className="inspector-review-hint">You've approved this shortlist. Choose "Make changes" below to edit it.</p>}
      </div>
    );
  }

  if (!editable) {
    if (!removed && !saved) return null;
    return (
      <div className={"inspector-review" + (removed ? " is-removed" : "")}>
        <span className="inspector-review-title">Client's review</span>
        <p className="inspector-review-verdict">{removed ? "Client removed this property" : "Client kept this property"}</p>
        {saved && <blockquote className="inspector-review-comment">{saved}</blockquote>}
      </div>
    );
  }

  return (
    <div className={"inspector-review" + (removed ? " is-removed" : "")}>
      <span className="inspector-review-title">Your decision</span>
      <div className="inspector-review-choice" role="group" aria-label="Keep or remove this property">
        <button
          type="button"
          className={"inspector-review-btn is-keep" + (!removed ? " is-on" : "")}
          aria-pressed={!removed}
          disabled={review.locked}
          onClick={() => review.onSetRemoved?.(mediaSiteId, false)}
        >
          <CheckIcon size={13} /> Keep
        </button>
        <button
          type="button"
          className={"inspector-review-btn is-remove" + (removed ? " is-on" : "")}
          aria-pressed={removed}
          disabled={review.locked}
          onClick={() => review.onSetRemoved?.(mediaSiteId, true)}
        >
          <CloseIcon size={13} /> Remove
        </button>
      </div>
      <textarea
        className="inspector-review-input"
        placeholder="Add a comment for the Adonmo team (optional)"
        value={draft}
        maxLength={1000}
        rows={2}
        disabled={review.locked}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {review.locked && <p className="inspector-review-hint">You've approved this shortlist. Choose "Make changes" below to edit it.</p>}
    </div>
  );
}

type PropertyImage = { url: string; thumbnailUrl: string; sourcePage: string };

// A plain Google Images search on "<property name>, <locality>" — the same
// results a rep would get typing that into Google by hand — used because
// the source sheet's own Drive photo links require sign-in and the Drive
// API is blocked on this Cloud project. Silently renders nothing while
// loading or if the search API isn't configured/returns no hits, same
// fail-quiet pattern as ClientLogo, rather than showing an error for what
// is a "nice to have" gallery.
function PropertyImages({ project }: { project: ProjectPanelInfo }) {
  const [images, setImages] = useState<PropertyImage[]>([]);

  useEffect(() => {
    let cancelled = false;
    setImages([]);
    const location = [project.locality, project.zone].filter(Boolean).join(" ");
    const params = new URLSearchParams({ name: project.name });
    if (location) params.set("location", location);
    fetch(`/api/property-images?${params.toString()}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ images?: PropertyImage[] }>) : { images: [] }))
      .then((data) => {
        if (!cancelled) setImages(data.images ?? []);
      })
      .catch(() => {
        if (!cancelled) setImages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project.name, project.locality, project.zone]);

  if (images.length === 0) return null;

  return (
    <div className="inspector-photo-strip">
      {images.map((img) => (
        <a key={img.url} className="inspector-photo-thumb" href={img.sourcePage} target="_blank" rel="noreferrer">
          <img src={img.thumbnailUrl} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

function ScreenView({
  screen,
  project,
  onNavigate,
}: {
  screen: SyntheticScreen;
  project: ProjectPanelInfo;
  onNavigate: (level: ViewLevel) => void;
}) {
  return (
    <>
      <header className="inspector-header">
        <h2>Screen {screen.id}</h2>
        <p className="inspector-sub">{project.name}</p>
      </header>

      <dl className="inspector-detail-list">
        <dt>Project</dt>
        <dd>{project.name}</dd>
        <dt>Location</dt>
        <dd>
          {project.locality ?? "—"}
          {project.zone ? ` · ${project.zone}` : ""}
        </dd>
        <dt>Screen size</dt>
        <dd>{screen.screenSize ?? "—"}</dd>
        <dt>Est. impressions/mo</dt>
        <dd>{screen.estImpressionsPerMonth?.toLocaleString() ?? "—"}</dd>
        <dt>Est. ad budget/mo</dt>
        <dd>{screen.estAdBudgetPerMonth ? `₹${screen.estAdBudgetPerMonth.toLocaleString()}` : "—"}</dd>
      </dl>

      <p className="inspector-hint">
        Metrics are an even split of the project's totals across its screens — this dataset doesn't track
        per-screen numbers or in-building position directly.
      </p>

      <button type="button" className="inspector-back" onClick={() => onNavigate("project")}>
        <ArrowLeftIcon size={14} /> Back to {project.name}
      </button>
    </>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={"inspector-stat" + (wide ? " inspector-stat-wide" : "")}>
      <span className="inspector-stat-label">{label}</span>
      <span className="inspector-stat-value">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="inspector-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="inspector-empty">{text}</p>;
}
