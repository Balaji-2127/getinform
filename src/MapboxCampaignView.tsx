import { useEffect, useState } from "react";
import MapboxMapExperience from "./MapboxMapExperience";
import { CITIES, type CityId } from "./data/cities";
import "./ClientCampaignView.css";

// Mapbox twin of ClientCampaignView.tsx — identical campaign-fetch logic,
// wired to MapboxMapExperience instead of MapExperience. Reuses
// ClientCampaignView.css directly since it's plain status-message styling
// with nothing Google-specific in it. No maps3d warmup needed here —
// mapbox-gl is a bundled import, not an async script load, so there's
// nothing to prefetch in parallel with the campaign lookup.
type CampaignResponse = {
  clientName: string;
  campaignName: string;
  selections: Record<string, string[]>;
};

function firstCityWithSelection(selections: Record<string, string[]>): CityId {
  const match = CITIES.find((c) => (selections[c.id]?.length ?? 0) > 0);
  return match?.id ?? CITIES[0].id;
}

export default function MapboxCampaignView({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CampaignResponse }>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Campaign not found");
        }
        return res.json() as Promise<CampaignResponse>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ status: "error", message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (state.status === "loading") {
    return <div className="campaign-view-status">Loading campaign…</div>;
  }
  if (state.status === "error") {
    return <div className="campaign-view-status campaign-view-error">{state.message}</div>;
  }

  return (
    <MapboxMapExperience
      initialCity={firstCityWithSelection(state.data.selections)}
      campaign={{
        label: `${state.data.clientName} — ${state.data.campaignName}`,
        brand: state.data.clientName.toUpperCase(),
        selections: state.data.selections,
      }}
    />
  );
}
