import { useEffect, useState } from "react";
import MapExperience from "./MapExperience";
import { CITIES, type CityId } from "./data/cities";
import { loadMaps3d } from "./google/loadGoogleMaps";
import "./ClientCampaignView.css";

type CampaignResponse = {
  clientName: string;
  campaignName: string;
  selections: Record<string, string[]>;
};

// A campaign's selections only include cities it actually shortlisted
// properties in; falls back to the app's default first city if somehow
// empty (shouldn't happen — the upload endpoint rejects empty selections).
function firstCityWithSelection(selections: Record<string, string[]>): CityId {
  const match = CITIES.find((c) => (selections[c.id]?.length ?? 0) > 0);
  return match?.id ?? CITIES[0].id;
}

export default function ClientCampaignView({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CampaignResponse }>({
    status: "loading",
  });

  // Kicked off in parallel with the campaign lookup, as early as this page
  // can possibly start it, so the maps3d library is already loading by the
  // time GoogleInventoryMap mounts and needs it instead of only starting
  // once the map component mounts. loadMaps3d() is memoized, so this is a
  // harmless warm-up; the real error handling still lives where the map
  // actually awaits it.
  useEffect(() => {
    loadMaps3d().catch(() => {});
  }, []);

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
    <MapExperience
      initialCity={firstCityWithSelection(state.data.selections)}
      campaign={{
        label: `${state.data.clientName} — ${state.data.campaignName}`,
        brand: state.data.clientName.toUpperCase(),
        selections: state.data.selections,
      }}
    />
  );
}
