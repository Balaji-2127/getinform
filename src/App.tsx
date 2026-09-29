import { useEffect, useState } from "react";
import LoginGate from "./LoginGate";
import Dashboard from "./dashboard/Dashboard";
import ClientCampaignView from "./ClientCampaignView";

// No router library — the app only ever has two shapes of URL: a shared
// campaign link on the Google 3D map (client-facing, no login), or
// everything else (the sales login/upload tool). Read once on mount; the
// app never navigates between these client-side, so nothing needs to
// watch for path changes.
function useRoute() {
  const [route] = useState(() => {
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
      {route.kind === "campaign" ? <ClientCampaignView campaignId={route.campaignId} /> : <SalesTool />}
    </div>
  );
}

export default App;
