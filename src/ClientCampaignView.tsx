import { useEffect, useState } from "react";
import MapExperience from "./MapExperience";
import { CITIES, type CityId } from "./data/cities";
import { loadMaps3d } from "./google/loadGoogleMaps";
import AdonmoScreenScene from "./AdonmoScreenScene";
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

  // How long the client actually has the campaign on screen. Only time the
  // tab is visible counts — a link left open in a background tab overnight
  // isn't time spent looking at it. Reported in slices (every 30 seconds,
  // and whenever the tab is hidden or closed) rather than once at the end,
  // because a closing page on a phone often never gets to send anything.
  // The server ignores these from a sales login, same as the open count.
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready) return;
    const url = `/api/campaigns/${campaignId}/view-time`;
    let visibleSince: number | null = document.visibilityState === "visible" ? Date.now() : null;

    const flush = () => {
      if (visibleSince === null) return;
      const now = Date.now();
      const seconds = Math.floor((now - visibleSince) / 1000);
      // Carry the leftover fraction of a second into the next slice so
      // rounding doesn't quietly lose time across many slices.
      visibleSince = document.visibilityState === "visible" ? now - ((now - visibleSince) % 1000) : null;
      if (seconds < 1) return;
      const body = JSON.stringify({ seconds });
      // sendBeacon survives the page being closed; fetch is the fallback.
      const sent = navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }));
      if (!sent) {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") visibleSince ??= Date.now();
      else flush();
    };

    const timer = window.setInterval(flush, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [ready, campaignId]);

  // The same link keeps showing the current shortlist after the team
  // edits it: re-read the campaign every 10 seconds while the tab is
  // visible and, if the shortlist changed, redraw in place (the map
  // restyles its pins rather than reloading). Not counted as an open.
  const selectionsKey = state.status === "ready" ? JSON.stringify(state.data.selections) : "";
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/campaigns/${campaignId}?poll=1`);
        if (!res.ok || stopped) return;
        const data = (await res.json()) as CampaignResponse;
        if (!stopped && JSON.stringify(data.selections) !== selectionsKey) setState({ status: "ready", data });
      } catch {
        // Offline for a moment: the next tick tries again.
      }
    };
    const timer = window.setInterval(poll, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [ready, campaignId, selectionsKey]);

  if (state.status === "loading") {
    return <div className="campaign-view-status">Loading campaign…</div>;
  }
  if (state.status === "error") {
    return <div className="campaign-view-status campaign-view-error">{state.message}</div>;
  }

  return (
    <div className="client-campaign">
      <MapExperience
        initialCity={firstCityWithSelection(state.data.selections)}
        campaign={{
          label: `${state.data.clientName} — ${state.data.campaignName}`,
          brand: state.data.clientName.toUpperCase(),
          clientName: state.data.clientName,
          selections: state.data.selections,
        }}
      />
      <AdonmoScreenScene clientName={state.data.clientName} />
    </div>
  );
}
