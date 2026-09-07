import { useEffect, useState } from "react";
import GoogleInventoryMap from "./GoogleInventoryMap";
import CitySidebar from "./CitySidebar";
import GlobeIntro from "./GlobeIntro";
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

function App() {
  useGoogleBannerOffset();
  const [activeCity, setActiveCity] = useState<CityId>("hyderabad");
  // "intro": globe visible, waiting for a city pick. "zooming": globe is
  // flying in toward the picked city (still mounted, InventoryMap mounts
  // underneath it too so it's ready and loaded by the time the globe fades
  // out). "map": globe unmounted, normal app.
  const [phase, setPhase] = useState<"intro" | "zooming" | "map">("intro");
  const [zoomTarget, setZoomTarget] = useState<[number, number] | null>(null);
  const [fading, setFading] = useState(false);

  const handleSelectCity = (id: CityId) => {
    setActiveCity(id);
    if (phase === "map") return;
    const city = CITIES.find((c) => c.id === id);
    if (!city) return;
    setZoomTarget(city.center);
    setPhase("zooming");
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: "#000000" }}>
      {phase !== "intro" && <GoogleInventoryMap cityId={activeCity} />}

      {phase !== "map" && (
        <GlobeIntro
          zoomTarget={zoomTarget}
          fading={fading}
          onFadeStart={() => setFading(true)}
          onComplete={() => setPhase("map")}
        />
      )}

      <CitySidebar activeCity={activeCity} onSelect={handleSelectCity} />
    </div>
  );
}

export default App;
