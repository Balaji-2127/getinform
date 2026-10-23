import { useEffect, useState } from "react";
import LoginGate from "./LoginGate";
import Dashboard from "./dashboard/Dashboard";
import ClientCampaignView from "./ClientCampaignView";
import { UserContext, type SessionUser } from "./auth";
import SetPasswordPage from "./SetPasswordPage";

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
  // undefined while checking; null when signed out.
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((data: { loggedIn: boolean; user?: SessionUser }) => setUser(data.loggedIn && data.user ? data.user : null))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return null;
  if (!user) return <LoginGate onSuccess={setUser} />;
  if (user.needsPassword) {
    return (
      <SetPasswordPage
        user={user}
        onDone={setUser}
        onSignOut={async () => {
          await fetch("/api/logout", { method: "POST" }).catch(() => {});
          setUser(null);
        }}
      />
    );
  }
  return (
    <UserContext.Provider value={user}>
      <Dashboard onLoggedOut={() => setUser(null)} />
    </UserContext.Provider>
  );
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
