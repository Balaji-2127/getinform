import { useEffect, useState } from "react";
import GoogleInventoryMap from "./GoogleInventoryMap";
import CitySidebar from "./CitySidebar";
import type { CityId } from "./data/cities";

// Google's own "alpha channel — for development purposes only" banner (its
// class name is unstable/internal, hence the aria-label match instead)
// injects itself at the very top of the page and overlaps our own
// top-anchored panels — a real layout bug, not cosmetic, since it eats
// pointer events too. It's asynchronous (added after the Maps script
// loads) and user-dismissible, so a MutationObserver tracks its actual
// presence/height rather than a fixed guess, and everything reclaims that
// space the moment the banner is gone (dismissed, or this API leaving
// alpha someday).
function useGoogleBannerOffset() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const banner = document.querySelector<HTMLElement>('[aria-label*="alpha channel"]');
      root.style.setProperty("--google-banner-offset", banner ? `${banner.getBoundingClientRect().height}px` : "0px");
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

export type CampaignContext = {
  label: string;
  // Short brand tag drawn on the campaign's own markers/clusters (e.g.
  // "LICIOUS") in place of the default "ADONMO" tag.
  brand: string;
  // Per-city shortlisted mediaSiteIds — only cities the campaign actually
  // covers are present. Absent entirely for the plain (non-campaign) map.
  selections: Record<string, string[]>;
};

export default function MapExperience({
  initialCity,
  campaign,
  hideCitySidebar,
  bannerPortalTarget,
}: {
  initialCity: CityId;
  campaign?: CampaignContext;
  // The dashboard embeds this component inside its own bounded panel,
  // which already has its own branding/navigation in the surrounding
  // shell (including the client's own logo, top-right) — the floating
  // "ADONMO + city picker" box is redundant there. Only applies in that
  // embedded context; defaults to the full-screen client-facing link's
  // existing city-picker-shown behavior, untouched.
  hideCitySidebar?: boolean;
  // See GoogleInventoryMap's own bannerPortalTarget — passed straight
  // through so the dashboard can pull the campaign banner out of the map
  // entirely and into its own page header. Undefined on the full-screen
  // client-facing link, which keeps the floating banner.
  bannerPortalTarget?: HTMLElement | null;
}) {
  useGoogleBannerOffset();
  const [activeCity, setActiveCity] = useState<CityId>(initialCity);

  const highlightedMediaSiteIds = campaign ? new Set(campaign.selections[activeCity] ?? []) : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000000" }}>
      <GoogleInventoryMap
        cityId={activeCity}
        highlightedMediaSiteIds={highlightedMediaSiteIds}
        campaignLabel={campaign?.label}
        highlightLabel={campaign?.brand}
        bannerPortalTarget={bannerPortalTarget}
      />

      {!hideCitySidebar && <CitySidebar activeCity={activeCity} onSelect={setActiveCity} />}
    </div>
  );
}
