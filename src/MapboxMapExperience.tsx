import { useState } from "react";
import MapboxInventoryMap from "./MapboxInventoryMap";
import CitySidebar from "./CitySidebar";
import type { CampaignContext } from "./MapExperience";
import type { CityId } from "./data/cities";

// Mapbox twin of MapExperience.tsx — same shape, same CampaignContext type
// (reused, not redefined), just wired to the Mapbox map component instead
// of the Google one. No Google alpha-channel banner to account for here.
export default function MapboxMapExperience({
  initialCity,
  campaign,
}: {
  initialCity: CityId;
  campaign?: CampaignContext;
}) {
  const [activeCity, setActiveCity] = useState<CityId>(initialCity);

  const highlightedMediaSiteIds = campaign ? new Set(campaign.selections[activeCity] ?? []) : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000000" }}>
      <MapboxInventoryMap
        cityId={activeCity}
        highlightedMediaSiteIds={highlightedMediaSiteIds}
        campaignLabel={campaign?.label}
        highlightLabel={campaign?.brand}
      />

      <CitySidebar activeCity={activeCity} onSelect={setActiveCity} />
    </div>
  );
}
