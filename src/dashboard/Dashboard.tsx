import { useState } from "react";
import UploadCampaign from "../UploadCampaign";
import DashboardHome from "./DashboardHome";
import CampaignsPage from "./CampaignsPage";
import InventoryPage from "./InventoryPage";
import ClientsPage from "./ClientsPage";
import ReportsPage from "./ReportsPage";
import HelpPage from "./HelpPage";
import GlobalSearch from "./GlobalSearch";
import { ToastProvider } from "./Toast";
import type { CityId } from "../data/cities";
import { CampaignsIcon, ClientsIcon, DashboardIcon, InventoryIcon, PlusIcon, ReportsIcon, HelpIcon, SidebarCollapseIcon } from "./icons";
import "./Dashboard.css";

type Section = "dashboard" | "campaigns" | "inventory" | "clients" | "reports" | "help" | "upload";

const NAV_ITEMS: { id: Section; label: string; icon: (props: { size?: number }) => React.ReactElement }[] = [
  { id: "dashboard", label: "Dashboard", icon: DashboardIcon },
  { id: "campaigns", label: "Campaigns", icon: CampaignsIcon },
  { id: "inventory", label: "Inventory", icon: InventoryIcon },
  { id: "clients", label: "Clients", icon: ClientsIcon },
  { id: "reports", label: "Reports", icon: ReportsIcon },
  { id: "help", label: "Help & FAQs", icon: HelpIcon },
];

export default function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [section, setSection] = useState<Section>("dashboard");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  // Remembered per-browser so a rep who collapses it once doesn't have to
  // redo it every reload — just a display preference, never read back by
  // anything else, so a plain try/catch-guarded localStorage read is fine.
  // With no saved preference yet (first visit), default to collapsed on a
  // narrow/phone-width screen instead of always starting expanded — the
  // full 220px labeled sidebar leaves barely any room for actual content
  // at phone widths. An explicit saved preference always wins either way.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("dash-sidebar-collapsed");
      if (saved !== null) return saved === "1";
      return window.matchMedia("(max-width: 640px)").matches;
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

  // Deleting the campaign that's currently loaded on the Campaigns tab has
  // to clear it here too, or switching back to that tab shows "Campaign not
  // found" for something the user just deliberately removed.
  const handleCampaignDeleted = (campaignId: string) => {
    setActiveCampaignId((current) => (current === campaignId ? null : current));
  };

  // Global search's property results jump here — switches to Inventory
  // and hands the target off to InventoryPage, which switches city (if
  // needed) and selects it on the map.
  const [focusProperty, setFocusProperty] = useState<{ cityId: CityId; mediaSiteId: string } | null>(null);
  const handleOpenProperty = (cityId: CityId, mediaSiteId: string) => {
    setFocusProperty({ cityId, mediaSiteId });
    setSection("inventory");
  };

  return (
    <ToastProvider>
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
          {/* Two groups rather than one flat list: the five working
              sections, then help on its own — the label is the only thing
              separating "where I work" from "where I go when stuck". */}
          {[
            { title: "Workspace", items: NAV_ITEMS.filter((i) => i.id !== "help") },
            { title: "Support", items: NAV_ITEMS.filter((i) => i.id === "help") },
          ].map((group) => (
            <div key={group.title} className="dash-nav-group">
              {!collapsed && <span className="dash-nav-group-title">{group.title}</span>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={"dash-nav-item" + (section === item.id ? " is-active" : "")}
                  onClick={() => setSection(item.id)}
                  title={collapsed ? item.label : undefined}
                  // Collapsed, these render as an icon with no text at all, so
                  // the accessible name has to come from somewhere else.
                  aria-label={item.label}
                  aria-current={section === item.id ? "page" : undefined}
                >
                  <span className="dash-nav-icon">
                    <item.icon size={18} />
                  </span>
                  {!collapsed && <span className="dash-nav-label">{item.label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot">
          <button
            type="button"
            className={"dash-upload-btn btn btn-primary" + (section === "upload" ? " is-active" : "")}
            onClick={() => setSection("upload")}
            title={collapsed ? "Upload campaign sheet" : undefined}
            aria-label="Upload campaign sheet"
          >
            <PlusIcon size={15} /> {!collapsed && "Upload campaign sheet"}
          </button>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-topbar">
          <GlobalSearch onOpenCampaign={handleCampaignCreated} onOpenProperty={handleOpenProperty} />
          <nav className="dash-toptabs">
            {NAV_ITEMS.slice(0, 4).map((item) => (
              <button key={item.id} type="button" className={"dash-toptab" + (section === item.id ? " is-active" : "")} onClick={() => setSection(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="dash-topbar-right">
            <button type="button" className="dash-avatar" onClick={handleLogout} title="Log out" aria-label="Log out">
              BD
            </button>
          </div>
        </header>

        <div className="dash-content">
          {section === "dashboard" && <DashboardHome onNavigate={setSection} onOpenCampaign={handleCampaignCreated} />}
          {section === "campaigns" && (
            <CampaignsPage activeCampaignId={activeCampaignId} onGoUpload={() => setSection("upload")} />
          )}
          {section === "inventory" && (
            <InventoryPage focusProperty={focusProperty} onFocusHandled={() => setFocusProperty(null)} onOpenCampaign={handleCampaignCreated} />
          )}
          {section === "clients" && <ClientsPage onOpenCampaign={handleCampaignCreated} onCampaignDeleted={handleCampaignDeleted} />}
          {section === "reports" && <ReportsPage onOpenCampaign={handleCampaignCreated} onCampaignDeleted={handleCampaignDeleted} />}
          {section === "help" && <HelpPage />}
          {section === "upload" && <UploadCampaign onCampaignCreated={handleCampaignCreated} />}
        </div>
      </div>
    </div>
    </ToastProvider>
  );
}
