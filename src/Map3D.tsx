import { useEffect, useRef, useState } from "react";
import {
  Map,
  NavigationControl,
  Source,
  Layer,
  Popup,
  type LayerProps,
  type ErrorEvent,
  type MapRef,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import "./Map3D.css";
import { sampleCommunity, SAMPLE_COMMUNITY_CENTER } from "./data/sampleCommunity";
import osmGapSample from "./data/osmGapSample.json";

export type Map3DMode = "overlay" | "osmgap";

// Hyderabad, India — default city-wide view.
const CITY_VIEW = { longitude: 78.4867, latitude: 17.385, zoom: 15.5 };
// Where each demo's own data lives.
const OSM_GAP_CENTER: [number, number] = [78.3489, 17.4948];

const PITCH = 60;
const BEARING = -17.6;

// CARTO Positron: free, no API key, no rate limit, OSM-based vector tiles.
const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const LABEL_LAYER_ID = "waterway_label";

const cityBuildingsLayer: LayerProps = {
  id: "3d-buildings",
  source: "carto",
  "source-layer": "building",
  type: "fill-extrusion",
  minzoom: 13,
  paint: {
    "fill-extrusion-color": "#c9c9c9",
    "fill-extrusion-height": [
      "coalesce",
      ["get", "render_height"],
      ["*", ["coalesce", ["get", "levels"], 1], 3.5],
      6,
    ],
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
    "fill-extrusion-opacity": 0.35,
  },
};

// Tab 1 — "Your Own Data": real per-tower heights, colored by role.
const sampleCommunityLayer: LayerProps = {
  id: "sample-community",
  type: "fill-extrusion",
  source: "sample-community",
  paint: {
    "fill-extrusion-color": ["match", ["get", "kind"], "amenity", "#d97706", "#4338ca"],
    "fill-extrusion-height": ["get", "height_m"],
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": 0.92,
  },
};

// Tab 4 — "Improve OSM": red = no height data (the vast majority), green = has it.
const osmGapLayer: LayerProps = {
  id: "osm-gap",
  type: "fill-extrusion",
  source: "osm-gap",
  paint: {
    "fill-extrusion-color": ["case", ["get", "has_height"], "#059669", "#dc2626"],
    "fill-extrusion-height": ["case", ["get", "has_height"], 20, 6],
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": 0.85,
  },
};

type PopupInfo = { longitude: number; latitude: number; html: string };

export default function Map3D({ mode }: { mode: Map3DMode }) {
  const mapRef = useRef<MapRef>(null);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<PopupInfo | null>(null);

  useEffect(() => {
    const target = mode === "overlay" ? SAMPLE_COMMUNITY_CENTER : OSM_GAP_CENTER;
    setPopup(null);
    mapRef.current?.flyTo({
      center: target,
      zoom: mode === "overlay" ? 17.2 : 17.5,
      pitch: PITCH,
      bearing: BEARING,
      duration: 1200,
    });
  }, [mode]);

  const handleClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setPopup(null);
      return;
    }
    const p = f.properties ?? {};
    const html =
      mode === "overlay"
        ? `<strong>${p.name}</strong><br/>${p.kind === "amenity" ? "Amenity block" : "Residential tower"}<br/>${p.floors} floors · ${p.height_m} m`
        : p.has_height
          ? `<strong>Has height data</strong><br/>height=${p.height ?? "—"} levels=${p.levels ?? "—"}`
          : `<strong>No height data</strong><br/>OSM only knows this is a "${p.building}" — rendered at a guessed height.`;
    setPopup({ longitude: e.lngLat.lng, latitude: e.lngLat.lat, html });
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        initialViewState={{ ...CITY_VIEW, pitch: PITCH, bearing: BEARING }}
        mapStyle={STYLE_URL}
        interactiveLayerIds={mode === "overlay" ? ["sample-community"] : ["osm-gap"]}
        onClick={handleClick}
        onError={(e: ErrorEvent) => {
          console.error("[Map3D] MapLibre error:", e.error);
          setError(e.error?.message ?? "Unknown map error — check the console.");
        }}
      >
        <NavigationControl position="top-right" visualizePitch />
        <Layer {...cityBuildingsLayer} beforeId={LABEL_LAYER_ID} />

        {mode === "overlay" && (
          <Source id="sample-community" type="geojson" data={sampleCommunity}>
            <Layer {...sampleCommunityLayer} />
          </Source>
        )}

        {mode === "osmgap" && (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <Source id="osm-gap" type="geojson" data={osmGapSample as any}>
            <Layer {...osmGapLayer} />
          </Source>
        )}

        {popup && (
          <Popup
            longitude={popup.longitude}
            latitude={popup.latitude}
            closeOnClick={false}
            onClose={() => setPopup(null)}
          >
            <div dangerouslySetInnerHTML={{ __html: popup.html }} />
          </Popup>
        )}
      </Map>

      <div className="map-caption">
        {mode === "overlay"
          ? "Fictional sample community — towers colored by role, heights are real per-tower values (not guesses). Click a block."
          : "Real OpenStreetMap data for a Hyderabad neighborhood — green has height data, red is guessed. Click a block."}
      </div>

      {error && <div className="map-error">Map error: {error}</div>}
    </div>
  );
}
