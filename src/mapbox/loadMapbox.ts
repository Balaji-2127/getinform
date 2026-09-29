import mapboxgl from "mapbox-gl";

let initialized = false;

/** Sets the Mapbox access token once. Throws clearly if it's missing rather
 * than letting mapbox-gl fail with an opaque 401 on first tile request. */
export function initMapbox(): typeof mapboxgl {
  if (!initialized) {
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
    if (!token) {
      throw new Error(
        "VITE_MAPBOX_ACCESS_TOKEN is not set. Add it to .env.local (see .env.example) — a Mapbox access token from https://account.mapbox.com/access-tokens/.",
      );
    }
    mapboxgl.accessToken = token;
    initialized = true;
  }
  return mapboxgl;
}
