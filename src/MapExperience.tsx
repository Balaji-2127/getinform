import { useEffect, useState } from "react";
import GoogleInventoryMap from "./GoogleInventoryMap";
import CitySidebar from "./CitySidebar";
import { CITIES, type CityId } from "./data/cities";

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
  hideBrand,
  bannerPortalTarget,
}: {
  initialCity: CityId;
  campaign?: CampaignContext;
  // The dashboard embeds this component inside its own bounded panel,
  // which already has its own branding/navigation in the surrounding
  // shell (including the client's own logo, top-right) — the floating
  // "ADONMO" logo/name block is redundant there. Only applies in that
  // embedded context; defaults to the full-screen client-facing link's
  // existing behavior, untouched. The city-switch buttons themselves stay
  // — for a multi-city campaign they're not decoration, they're how you
  // get from one city's highlighted properties to another's.
  hideBrand?: boolean;
  // See GoogleInventoryMap's own bannerPortalTarget — passed straight
  // through so the dashboard can pull the campaign banner out of the map
  // entirely and into its own page header. Undefined on the full-screen
  // client-facing link, which keeps the floating banner.
  bannerPortalTarget?: HTMLElement | null;
}) {
  useGoogleBannerOffset();
  const [activeCity, setActiveCity] = useState<CityId>(initialCity);

  const highlightedMediaSiteIds = campaign ? new Set(campaign.selections[activeCity] ?? []) : undefined;

  // A campaign's own cities only — picking a city with nothing shortlisted
  // in it would just show an empty, unhighlighted map, so the picker only
  // offers what's actually relevant to this campaign. Falls back to every
  // city when there's no campaign at all (shouldn't happen in practice —
  // MapExperience is only ever used for campaign views today — but keeps
  // this correct if that changes).
  const campaignCities = campaign ? CITIES.filter((c) => (campaign.selections[c.id]?.length ?? 0) > 0) : CITIES;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000000" }}>
      <GoogleInventoryMap
        cityId={activeCity}
        highlightedMediaSiteIds={highlightedMediaSiteIds}
        campaignLabel={campaign?.label}
        highlightLabel={campaign?.brand}
        bannerPortalTarget={bannerPortalTarget}
      />

      {(!hideBrand || campaignCities.length > 1) && (
        <CitySidebar activeCity={activeCity} onSelect={setActiveCity} cities={campaignCities} hideBrand={hideBrand} />
      )}
    </div>
  );
}
