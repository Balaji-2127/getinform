import { useState } from "react";
import UploadCampaign from "../UploadCampaign";
import DashboardHome from "./DashboardHome";
import CampaignsPage from "./CampaignsPage";
import InventoryPage from "./InventoryPage";
import ClientsPage from "./ClientsPage";
import InsightsPage from "./InsightsPage";
import ReportsPage from "./ReportsPage";
import ComingSoon from "./ComingSoon";
import {
  AiIcon,
  AreasIcon,
  BellIcon,
  CampaignsIcon,
  ClientsIcon,
  DashboardIcon,
  InsightsIcon,
  InventoryIcon,
  PlusIcon,
  RecentIcon,
  ReportsIcon,
  SearchIcon,
  ShortlistIcon,
  SidebarCollapseIcon,
} from "./icons";
import "./Dashboard.css";

type Section = "dashboard" | "campaigns" | "inventory" | "clients" | "insights" | "ai" | "reports" | "areas" | "shortlists" | "recent" | "upload";

const NAV_ITEMS: { id: Section; label: string; icon: (props: { size?: number }) => React.ReactElement }[] = [
  { id: "dashboard", label: "Dashboard", icon: DashboardIcon },
  { id: "campaigns", label: "Campaigns", icon: CampaignsIcon },
  { id: "inventory", label: "Inventory", icon: InventoryIcon },
  { id: "clients", label: "Clients", icon: ClientsIcon },
  { id: "insights", label: "Market Insights", icon: InsightsIcon },
  { id: "ai", label: "AI Assistant", icon: AiIcon },
  { id: "reports", label: "Reports", icon: ReportsIcon },
];

const SAVED_ITEMS: { id: Section; label: string; icon: (props: { size?: number }) => React.ReactElement }[] = [
  { id: "areas", label: "My Areas", icon: AreasIcon },
  { id: "shortlists", label: "Shortlists", icon: ShortlistIcon },
  { id: "recent", label: "Recent Searches", icon: RecentIcon },
];

const SECTION_TITLES: Record<Section, string> = {
  dashboard: "Dashboard",
  campaigns: "Campaigns",
  inventory: "Inventory",
  clients: "Clients",
  insights: "Market Insights",
  ai: "AI Assistant",
  reports: "Reports",
  areas: "My Areas",
  shortlists: "Shortlists",
  recent: "Recent Searches",
  upload: "Upload campaign sheet",
};

// This dashboard is a new sales-facing screen. It does not replace the
// existing Excel-upload flow (UploadCampaign, unchanged) — that stays
// reachable via the "Upload campaign sheet" button, and successfully
// uploading (or opening a past campaign) jumps straight to the Campaigns
// page with that campaign's real, highlighted results embedded there
// (same MapExperience the client-facing link uses). Inventory is a
// separate, real, campaign-agnostic browse-everything view. Clients groups
// real campaign history (GET /api/campaigns) by client name; Market
// Insights is real aggregate stats computed from the same per-city
// inventory files Inventory uses; Dashboard (the landing page) is a
// summary built from that same campaign + inventory data; Reports is a
// full sortable/exportable table of that same campaign history — no
// fabricated CRM, analytics, or industry data anywhere in the five of
// them. Everything else in the reference layout with no real data or
// backend behind it yet (AI Assistant, Saved section) renders as an
// explicit "coming soon" placeholder instead of pretending to work.
export default function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [section, setSection] = useState<Section>("dashboard");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  // Remembered per-browser so a rep who collapses it once doesn't have to
  // redo it every reload — just a display preference, never read back by
  // anything else, so a plain try/catch-guarded localStorage read is fine.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dash-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dash-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // ignore — worst case it just doesn't persist
      }
      return next;
    });
  };

  const handleLogout = async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    onLoggedOut();
  };

  // Fires after a successful upload, or when opening a past campaign from
  // the list — either way, jump straight to the Campaigns page so the
  // result is immediately visible, embedded, instead of leaving the rep
  // on the upload form with just a link to click elsewhere.
  const handleCampaignCreated = (campaignId: string) => {
    setActiveCampaignId(campaignId);
    setSection("campaigns");
  };

  return (
    <div className="dash-shell">
      <aside className={"dash-sidebar" + (collapsed ? " is-collapsed" : "")}>
        <div className="dash-brand">
          <img src="/adonmo-logo.jpeg" alt="" className="dash-brand-logo" />
          {!collapsed && (
            <div>
              <span className="dash-brand-name">ADONMO</span>
              <span className="dash-brand-sub">DOOH Inventory &amp; Campaigns</span>
            </div>
          )}
          <button
            type="button"
            className="dash-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <SidebarCollapseIcon size={15} />
          </button>
        </div>

        <nav className="dash-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"dash-nav-item" + (section === item.id ? " is-active" : "")}
              onClick={() => setSection(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <item.icon />
              {!collapsed && item.label}
            </button>
          ))}
        </nav>

        <div className="dash-saved">
          {!collapsed && <span className="dash-saved-title">Saved</span>}
          {SAVED_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"dash-nav-item" + (section === item.id ? " is-active" : "")}
              onClick={() => setSection(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <item.icon />
              {!collapsed && item.label}
            </button>
          ))}
        </div>

        <button type="button" className="dash-upload-btn" onClick={() => setSection("upload")} title={collapsed ? "Upload campaign sheet" : undefined}>
          <PlusIcon size={14} /> {!collapsed && "Upload campaign sheet"}
        </button>
      </aside>

      <div className="dash-main">
        <header className="dash-topbar">
          <div className="dash-search-bar">
            <SearchIcon size={15} />
            <span>Search properties, localities, clients, or keywords…</span>
            <span className="dash-kbd">Ctrl K</span>
          </div>
          <nav className="dash-toptabs">
            {NAV_ITEMS.slice(0, 5).map((item) => (
              <button key={item.id} type="button" className={"dash-toptab" + (section === item.id ? " is-active" : "")} onClick={() => setSection(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
          <button type="button" className="dash-bell" disabled title="Not yet implemented">
            <BellIcon />
          </button>
          <button type="button" className="dash-avatar" onClick={handleLogout} title="Log out">
            BD
          </button>
        </header>

        <div className="dash-content">
          {section === "dashboard" && <DashboardHome onNavigate={setSection} onOpenCampaign={handleCampaignCreated} />}
          {section === "campaigns" && <CampaignsPage activeCampaignId={activeCampaignId} onGoUpload={() => setSection("upload")} />}
          {section === "inventory" && <InventoryPage />}
          {section === "clients" && <ClientsPage onOpenCampaign={handleCampaignCreated} />}
          {section === "insights" && <InsightsPage />}
          {section === "reports" && <ReportsPage onOpenCampaign={handleCampaignCreated} />}
          {section === "upload" && <UploadCampaign onCampaignCreated={handleCampaignCreated} />}
          {section !== "dashboard" &&
            section !== "campaigns" &&
            section !== "inventory" &&
            section !== "clients" &&
            section !== "insights" &&
            section !== "reports" &&
            section !== "upload" && <ComingSoon title={SECTION_TITLES[section]} />}
        </div>
      </div>
    </div>
  );
}
