import type { ReactNode } from "react";
import "./StatCard.css";

export type StatTone = "indigo" | "green" | "orange" | "blue";

// One shared stat card. This component was copy-pasted into four pages
// (DashboardHome, InventoryPage, InsightsPage, ReportsPage) with slightly
// different prop shapes, each taking its icon as an emoji string — so the
// same card rendered four slightly different ways and there was no single
// place to restyle it.
//
// `value === null` renders the number as a skeleton instead of a "…"
// placeholder: these cards are the first thing on the page and every one of
// them is waiting on a fetch, so three dots was the first impression the
// whole dashboard made.
export default function StatCard({
  icon,
  label,
  sub,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  value: string | null;
  tone: StatTone;
}) {
  return (
    <div className={`stat-card stat-card-${tone}`}>
      <span className="stat-card-icon">{icon}</span>
      <div className="stat-card-text">
        {value === null ? <span className="stat-card-value-skel skel" /> : <span className="stat-card-value">{value}</span>}
        <span className="stat-card-label">{label}</span>
        {sub && <span className="stat-card-sub">{sub}</span>}
      </div>
    </div>
  );
}
