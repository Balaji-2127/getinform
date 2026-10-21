import { useEffect, useMemo, useRef, useState } from "react";
import MapExperience from "./MapExperience";
import { CITIES, type CityId } from "./data/cities";
import { loadMaps3d } from "./google/loadGoogleMaps";
import type { CampaignReview, MapReview } from "./review";
import ReviewBar from "./ReviewBar";
import AdonmoScreenScene from "./AdonmoScreenScene";
import "./ClientCampaignView.css";

type CampaignResponse = {
  clientName: string;
  campaignName: string;
  selections: Record<string, string[]>;
  review: CampaignReview | null;
};

// A campaign's selections only include cities it actually shortlisted
// properties in; falls back to the app's default first city if somehow
// empty (shouldn't happen — the upload endpoint rejects empty selections).
function firstCityWithSelection(selections: Record<string, string[]>): CityId {
  const match = CITIES.find((c) => (selections[c.id]?.length ?? 0) > 0);
  return match?.id ?? CITIES[0].id;
}

const EMPTY_REVIEW: CampaignReview = {
  removed: [],
  added: {},
  comments: {},
  status: "in_review",
  approvedAt: null,
  approvedBy: null,
  note: null,
  updatedAt: "",
};

// Clicks are batched for this long before saving, so flicking between Keep
// and Remove sends one request rather than one per click.
const REVIEW_SAVE_DELAY_MS = 400;

export type SaveState = "idle" | "saving" | "saved" | "error";

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
        if (cancelled) return;
        setState({ status: "ready", data });
        setReview(data.review ?? EMPTY_REVIEW);
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

  // ---- the client's review -------------------------------------------------
  // Saved as they go rather than behind a "Save" button: a client clicking
  // through properties on a phone shouldn't lose their picks by closing the
  // tab before reaching the end. The whole review is sent each time, so the
  // latest one always wins.
  const [review, setReview] = useState<CampaignReview>(EMPTY_REVIEW);
  // The latest review, for callbacks that fire after a delay (the comment
  // box saves on a timer) — they must build on what is current then, not on
  // what was current when they were created, or a comment saved just after
  // a Remove click would quietly undo the removal.
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pendingRef = useRef<CampaignReview | null>(null);
  const timerRef = useRef<number | null>(null);

  const send = async (next: CampaignReview): Promise<CampaignReview | null> => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        keepalive: true,
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { review: CampaignReview };
      // Something newer may have been queued while this was in flight.
      setSaveState(pendingRef.current ? "saving" : "saved");
      return body.review;
    } catch {
      setSaveState("error");
      return null;
    }
  };

  const flushReview = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) void send(next);
  };

  const queueSave = (update: (current: CampaignReview) => CampaignReview) => {
    const next = update(reviewRef.current);
    reviewRef.current = next;
    setReview(next);
    pendingRef.current = next;
    setSaveState("saving");
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flushReview, REVIEW_SAVE_DELAY_MS);
  };

  // Anything still waiting when the page goes away gets sent immediately
  // (keepalive lets it outlive the page).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushReview();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushReview);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushReview);
      flushReview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const approve = async (approvedBy: string, note: string): Promise<boolean> => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    pendingRef.current = null;
    const saved = await send({ ...reviewRef.current, status: "approved", approvedBy, note });
    if (saved) setReview(saved);
    return Boolean(saved);
  };

  const reopen = async () => {
    const next: CampaignReview = { ...reviewRef.current, status: "in_review", approvedAt: null, approvedBy: null };
    setReview(next);
    const saved = await send(next);
    if (saved) setReview(saved);
  };

  const removedSet = useMemo(() => new Set(review.removed), [review.removed]);
  const addedSet = useMemo(() => new Set(Object.values(review.added ?? {}).flat()), [review.added]);
  const mapReview: MapReview = useMemo(
    () => ({
      removed: removedSet,
      added: addedSet,
      comments: review.comments,
      audience: "client",
      locked: review.status === "approved",
      onSetRemoved: (id, removed) =>
        queueSave((current) => ({
          ...current,
          removed: removed ? [...new Set([...current.removed, id])] : current.removed.filter((x) => x !== id),
        })),
      onSetAdded: (cityId, id, add) =>
        queueSave((current) => {
          const added = { ...(current.added ?? {}) };
          const ids = added[cityId] ?? [];
          added[cityId] = add ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
          if (added[cityId].length === 0) delete added[cityId];
          return { ...current, added };
        }),
      onComment: (id, comment) =>
        queueSave((current) => {
          const comments = { ...current.comments };
          if (comment.trim()) comments[id] = comment.trim();
          else delete comments[id];
          return { ...current, comments };
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [review, removedSet, addedSet],
  );

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
        review={mapReview}
      />
      {/* Client link only — rendered here rather than inside MapExperience so
          the sales dashboard, which embeds the same map, never shows it. */}
      <AdonmoScreenScene clientName={state.data.clientName} />
      <ReviewBar
        selections={state.data.selections}
        review={review}
        saveState={saveState}
        onApprove={approve}
        onReopen={reopen}
      />
    </div>
  );
}
