import { lazy, Suspense, useEffect, useState } from "react";
import LoginGate from "./LoginGate";
import Dashboard from "./dashboard/Dashboard";
import ClientCampaignView from "./ClientCampaignView";

// Lazy: mapbox-gl is a large library that only the /campaign-mb route
// needs. Importing it statically here would pull its full weight into the
// main bundle every other route pays for too (sales login/upload, the
// Google campaign view) — this keeps it out of their way entirely.
const MapboxCampaignView = lazy(() => import("./MapboxCampaignView"));

// No router library — the app only ever has three shapes of URL: a shared
// campaign link on the Google 3D map (client-facing, no login), the same
// campaign on the parallel Mapbox map (a separate engine kept alongside the
// Google one, not a replacement — see MapboxInventoryMap.tsx), or everything
// else (the sales login/upload tool). Read once on mount; the app never
// navigates between these client-side, so nothing needs to watch for path
// changes.
function useRoute() {
  const [route] = useState(() => {
    const mapboxMatch = window.location.pathname.match(/^\/campaign-mb\/([^/]+)/);
    if (mapboxMatch) return { kind: "campaign-mapbox" as const, campaignId: mapboxMatch[1] };
    const match = window.location.pathname.match(/^\/campaign\/([^/]+)/);
    return match ? { kind: "campaign" as const, campaignId: match[1] } : { kind: "sales" as const };
  });
  return route;
}

function SalesTool() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((data: { loggedIn: boolean }) => setLoggedIn(data.loggedIn))
      .catch(() => setLoggedIn(false));
  }, []);

  if (loggedIn === null) return null;
  if (!loggedIn) return <LoginGate onSuccess={() => setLoggedIn(true)} />;
  return <Dashboard onLoggedOut={() => setLoggedIn(false)} />;
}

function App() {
  const route = useRoute();

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000000" }}>
      {route.kind === "campaign" ? (
        <ClientCampaignView campaignId={route.campaignId} />
      ) : route.kind === "campaign-mapbox" ? (
        <Suspense
          fallback={
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f3f4f6",
                fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
                fontSize: 14,
              }}
            >
              Loading map…
            </div>
          }
        >
          <MapboxCampaignView campaignId={route.campaignId} />
        </Suspense>
      ) : (
        <SalesTool />
      )}
    </div>
  );
}

export default App;
