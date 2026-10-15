// Official Google Maps JS API dynamic-library bootstrap loader — Google's
// own snippet (https://developers.google.com/maps/documentation/javascript/load-maps-js-api),
// converted to TypeScript and reading the key from our env instead of being
// inlined by hand. This defines `google.maps.importLibrary`, which is what
// the rest of src/google/ uses to pull in the `maps3d` library on demand.
type ImportLibraryFn = (name: string, ...args: unknown[]) => Promise<unknown>;

function bootstrap(apiKey: string): void {
  // "alpha" — the only channel where the 3D map's flat ROADMAP mode (our
  // light "Map" view, used by the inventory map and every client link)
  // renders. Beta 3.66.8b briefly supported it, then 3.66.9d stopped:
  // the map just spins, as it does on "weekly". Satellite works everywhere
  // but breaks the 3D buildings (see GoogleInventoryMap). Alpha's one cost
  // is Google's "development purposes only" banner, which
  // dismissGoogleAlphaBanner() below clicks away as soon as it appears.
  const g = { key: apiKey, v: "alpha" };
  let loadPromise: Promise<void> | undefined;
  const doc = document;
  const win = window as unknown as { google?: { maps?: Record<string, unknown> } };
  const google = (win.google ||= {});
  const maps = (google.maps ||= {});
  const requestedLibraries = new Set<string>();

  const startLoad = () =>
    loadPromise ||
    (loadPromise = new Promise<void>((resolve, reject) => {
      const script = doc.createElement("script");
      const params = new URLSearchParams();
      params.set("libraries", [...requestedLibraries].join(","));
      for (const [key, value] of Object.entries(g)) {
        params.set(key.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), String(value));
      }
      params.set("callback", "google.maps.__ib__");
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      (maps as Record<string, unknown>).__ib__ = resolve;
      script.onerror = () => reject(new Error("The Google Maps JavaScript API could not load."));
      script.nonce = doc.querySelector("script[nonce]")?.getAttribute("nonce") || "";
      doc.head.append(script);
    }));

  if (maps.importLibrary) {
    console.warn("The Google Maps JavaScript API bootstrap only needs to run once. Ignoring a second call.");
    return;
  }
  maps.importLibrary = ((name: string) => {
    requestedLibraries.add(name);
    return startLoad().then(() => (maps.importLibrary as ImportLibraryFn)(name));
  }) as unknown as Record<string, unknown>["importLibrary"];
}

// Google adds an "Using the alpha channel … for development purposes only"
// strip above the page whenever a map mounts on the alpha channel. It is
// meant for developers, overlaps the app's own header, and has its own
// Dismiss button — so the app presses it the moment the strip appears,
// and users never see it. Matched by aria-label because Google's class
// names are internal and change (MapExperience matches it the same way).
let bannerWatcherStarted = false;
function dismissGoogleAlphaBanner(): void {
  if (bannerWatcherStarted || typeof MutationObserver === "undefined") return;
  bannerWatcherStarted = true;
  const dismiss = () => {
    const banner = document.querySelector<HTMLElement>('[aria-label*="alpha channel"]');
    if (!banner) return;
    const button = [...banner.querySelectorAll<HTMLElement>("button, a, [role=button]")].find((el) => /dismiss/i.test(el.textContent ?? ""));
    if (button) button.click();
    else banner.style.display = "none";
  };
  new MutationObserver(dismiss).observe(document.body, { childList: true, subtree: true });
  dismiss();
}

export function loadGoogleMapsBootstrap(): void {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error(
      "VITE_GOOGLE_MAPS_API_KEY is not set. Add it to .env.local (see .env.example) — a Google Maps Platform API key with a Cloud Billing account attached.",
    );
  }
  bootstrap(apiKey);
  dismissGoogleAlphaBanner();
}

let maps3dPromise: Promise<google.maps.Maps3DLibrary> | null = null;

/** Loads the bootstrap script (once) and resolves the `maps3d` library. */
export function loadMaps3d(): Promise<google.maps.Maps3DLibrary> {
  if (!maps3dPromise) {
    loadGoogleMapsBootstrap();
    maps3dPromise = google.maps.importLibrary("maps3d") as Promise<google.maps.Maps3DLibrary>;
  }
  return maps3dPromise;
}
