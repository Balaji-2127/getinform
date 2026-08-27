import type { ReactNode } from "react";
import "./InspectorPanel.css";
import type { SyntheticScreen } from "./syntheticScreens";

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
};

export type ViewLevel = "city" | "cluster" | "project" | "screen";

type Content =
  | { kind: "cluster"; cluster: ClusterInfo }
  | { kind: "project"; project: ProjectPanelInfo }
  | { kind: "screen"; screen: SyntheticScreen; project: ProjectPanelInfo };

type Crumb = { label: string; level: ViewLevel };

export default function InspectorPanel({
  content,
  crumbs,
  selectedScreenId,
  onNavigate,
  onClose,
  onSelectScreen,
}: {
  content: Content | null;
  crumbs: Crumb[];
  selectedScreenId: string | null;
  onNavigate: (level: ViewLevel) => void;
  onClose: () => void;
  onSelectScreen: (screenId: string) => void;
}) {
  if (!content) return null;

  return (
    <div className="inspector-panel">
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

      {content.kind === "cluster" && <ClusterView cluster={content.cluster} />}
      {content.kind === "project" && (
        <ProjectView project={content.project} selectedScreenId={selectedScreenId} onSelectScreen={onSelectScreen} />
      )}
      {content.kind === "screen" && (
        <ScreenView screen={content.screen} project={content.project} onNavigate={onNavigate} />
      )}

      <button type="button" className="inspector-close" onClick={onClose} aria-label="Close inspector">
        ×
      </button>
    </div>
  );
}

function ClusterView({ cluster }: { cluster: ClusterInfo }) {
  return (
    <>
      <header className="inspector-header">
        <h2>Cluster overview</h2>
        <p className="inspector-sub">{cluster.pointCount} sites covered</p>
      </header>

      <div className="inspector-stats">
        <Stat label="Total screens" value={cluster.totalScreens.toLocaleString()} />
        <Stat label="Households" value={cluster.totalHouseholds.toLocaleString()} />
        <Stat label="Impressions/mo" value={cluster.totalImpressions.toLocaleString()} />
        <Stat label="Est. daily footfall" value={cluster.dailyFootfall.toLocaleString()} />
        <Stat label="Ad budget/mo" value={`₹${cluster.totalAdBudget.toLocaleString()}`} wide />
      </div>

      <Section title="Localities covered">
        {cluster.localities.length === 0 ? (
          <Empty text="No locality data" />
        ) : (
          <ul className="inspector-list">
            {cluster.localities.map((l) => (
              <li key={l.name}>
                <span>{l.name}</span>
                <span className="inspector-count">{l.count}</span>
              </li>
            ))}
            {cluster.moreLocalities > 0 && <li className="inspector-more">+{cluster.moreLocalities} more</li>}
          </ul>
        )}
      </Section>

      <Section title="Zones covered">
        {cluster.zones.length === 0 ? (
          <Empty text="No zone data" />
        ) : (
          <ul className="inspector-list">
            {cluster.zones.map((z) => (
              <li key={z.name}>
                <span>{z.name}</span>
                <span className="inspector-count">{z.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="inspector-hint">Click an orange project marker to drill in.</p>
    </>
  );
}

function ProjectView({
  project,
  selectedScreenId,
  onSelectScreen,
}: {
  project: ProjectPanelInfo;
  selectedScreenId: string | null;
  onSelectScreen: (screenId: string) => void;
}) {
  return (
    <>
      <header className="inspector-header">
        <h2>{project.name}</h2>
        <p className="inspector-sub">
          {project.locality ?? "—"}
          {project.zone ? ` · ${project.zone}` : ""}
        </p>
      </header>

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

      <Section title={`Screens (${project.screenList.length}${project.hiddenScreenCount > 0 ? ` of ${project.totalScreens}` : ""})`}>
        {project.screenList.length === 0 ? (
          <Empty text="No screens recorded for this project" />
        ) : (
          <ul className="inspector-list inspector-screen-list">
            {project.screenList.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={"inspector-screen-button" + (s.id === selectedScreenId ? " is-active" : "")}
                  onClick={() => onSelectScreen(s.id)}
                >
                  <span>{s.id}</span>
                  <span className="inspector-count">{s.screenSize ?? "—"}</span>
                </button>
              </li>
            ))}
            {project.hiddenScreenCount > 0 && (
              <li className="inspector-more">+{project.hiddenScreenCount} more not shown (aggregated in totals above)</li>
            )}
          </ul>
        )}
      </Section>

      <p className="inspector-hint">
        Screen positions are illustrative — this dataset tracks a screen count per project, not individual
        in-building placement.
      </p>
    </>
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
        ← Back to {project.name}
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
