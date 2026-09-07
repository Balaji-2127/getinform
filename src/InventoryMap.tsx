import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map,
  NavigationControl,
  Source,
  Layer,
  type LayerProps,
  type ErrorEvent,
  type MapRef,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./InventoryMap.css";
import { CITIES, loadCityScreens, type CityId, type ScreenFeatureCollection } from "./data/cities";
import InspectorPanel, { type ClusterInfo, type ProjectPanelInfo, type ViewLevel } from "./InspectorPanel";
import { generateSyntheticScreens, screensToFeatureCollection, type SyntheticScreen } from "./syntheticScreens";

type ProjectFeature = ScreenFeatureCollection["features"][number];
type Bbox = [[number, number], [number, number]];

// ---------------------------------------------------------------------------
// Camera states — each level gets a distinct pitch/bearing so the transition
// itself communicates "you just went one level deeper", per the brief. Exact
// zoom is always derived from the geographic extent of what's selected
// (fitBounds for city/cluster), never hard-coded, except at project level
// where a single point has no extent to fit.
//
// MapLibre's hard default is maxPitch = 60° (anything above is silently
// clamped, no error) — pitches above that are flagged "experimental" in its
// own docs. An earlier pass here used 65° for the project view, which was
// being clamped to 60 the whole time, so cluster (58°) and project (~60°)
// barely read as different tilts. Keeping both within the real ceiling.
// ---------------------------------------------------------------------------
const CITY_VIEW_PITCH = 45;
const CLUSTER_PITCH = 55;
const CLUSTER_BEARING = -25;
const PROJECT_PITCH = 60;
const PROJECT_BEARING = 30;

// A wide cluster's *natural* fitBounds zoom can be as low as z11-13 —
// exactly where buildings are thin or invisible — because it's sized to fit
// every point in the cluster, however far apart they are. Per the brief
// ("camera distance should adapt... occupy a meaningful portion of the
// viewport"), the fix isn't a fixed zoom, it's a FLOOR: fly to the natural
// framing when it's already close, but never let it go wider than this, so
// the buildings that make the scene read as "3D" are always big enough to
// see. Some outlying markers in a geographically wide cluster may fall
// outside the frame — a deliberate trade, since a technically-complete but
// flat wide shot is a worse experience than a genuinely 3D close one.
const CLUSTER_MIN_ZOOM = 15.6;
const CLUSTER_MAX_ZOOM = 18;
const PROJECT_MIN_ZOOM = 17.6;
const PROJECT_MAX_ZOOM = 19.5;

// A building this short is CARTO/OSM's generic "no real height or levels
// tag" stub, not a measured single-story structure — see the diagnostic
// notes below buildingsLayer. Anything at or under this is treated as
// "unknown" and given an illustrative height instead of a flat plate.
const STUB_HEIGHT_THRESHOLD = 6;
// Typical low-rise residential height assumed for buildings with no real
// OSM height/levels data (~G+2). This is a disclosed estimate, not survey
// data — see the "illustrative" caption rendered on the map.
const ASSUMED_LOWRISE_HEIGHT = 11;

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const LABEL_LAYER_ID = "waterway_label";
const MAX_LOCALITIES_SHOWN = 6;

// DIAGNOSIS (see conversation for full methodology): queried live rendered
// features from both CARTO's `building` source-layer and OpenFreeMap's
// (same OpenStreetMap-derived schema, different provider) across five
// Hyderabad neighborhoods. Two findings, confirmed on both providers so
// it's an OSM data-completeness issue, not a CARTO-specific limitation:
//   1. `render_height` IS present on nearly every feature and WAS being
//      read correctly — but ~65% of buildings carry the generic "no real
//      height/levels tag" stub value (~5m), which is imperceptible as 3D
//      even at a steep pitch. The extrusion was working; the input heights
//      were just almost all flat.
//   2. Building *footprint* coverage itself is sparse in large parts of
//      Hyderabad — many residential blocks (exactly where Adonmo's
//      projects sit) have no traced building polygon at all in OSM, on
//      either provider. Switching tile providers would not fix this.
// Fix: treat stub-looking heights as "unknown" and substitute a disclosed,
// uniform low-rise estimate instead of a flat plate (fix below); and add a
// separate synthetic volume anchored at every Adonmo project's own
// coordinate (projectBuildingsLayer, further down) so a 3D volume is always
// visible at the locations that actually matter, regardless of OSM gaps.
const buildingsLayer: LayerProps = {
  id: "3d-buildings",
  source: "carto",
  "source-layer": "building",
  type: "fill-extrusion",
  minzoom: 13,
  paint: {
    // Warm sand-to-stone gradient by height (Mapbox Standard reference),
    // instead of a flat cool gray — real height data drives it (our own
    // stub-height fallback included), no per-building type is invented.
    "fill-extrusion-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "render_height"], 0],
      0, "#ead9bd",
      20, "#d8c39d",
      45, "#b3a898",
    ],
    "fill-extrusion-height": [
      "case",
      ["<=", ["coalesce", ["get", "render_height"], 0], STUB_HEIGHT_THRESHOLD],
      ASSUMED_LOWRISE_HEIGHT,
      ["get", "render_height"],
    ],
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
    // More opaque/solid than a translucent glassy look — closer to the
    // fully-painted premium feel of the reference. Buildings get more
    // prominent as the user drills toward a single project, per the "3D
    // building: prominent" project-level camera state.
    "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.55, 15, 0.8, 18, 0.97],
    "fill-extrusion-vertical-gradient": true,
  },
};

// Real park/nature-reserve polygons (CARTO's own `park` source-layer),
// lightly extruded as a "canopy" — greenery for spatial read, without
// inventing individual tree positions the data doesn't have.
const parkCanopyLayer: LayerProps = {
  id: "park-canopy",
  source: "carto",
  "source-layer": "park",
  type: "fill-extrusion",
  minzoom: 14,
  paint: {
    "fill-extrusion-color": "#a9d19a",
    "fill-extrusion-height": 4,
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.35, 17, 0.55],
  },
};

// Guaranteed-visible 3D volume at every Adonmo project, independent of
// whether OSM happens to have a traced building footprint nearby (per the
// diagnosis above, it very often doesn't). This is what actually fixes
// "I click a project and still see a flat map" for the interaction that
// matters most — real building extrusion is a bonus where OSM has it, this
// is the floor. Explicitly NOT a traced footprint: a small square anchored
// on the project's own point, sized within a plausible low-rise band using
// the project's real household count as the only input (more households ->
// taller estimate) — disclosed as illustrative in the UI, never presented
// as a measured building outline.
const PROJECT_FOOTPRINT_HALF_SIDE_METERS = 9;
const projectBuildingsLayer: LayerProps = {
  id: "project-buildings",
  type: "fill-extrusion",
  source: "project-buildings",
  minzoom: 14,
  paint: {
    "fill-extrusion-color": ["case", ["boolean", ["feature-state", "selected"], false], "#6366f1", "#818cf8"],
    "fill-extrusion-height": ["get", "estHeight"],
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.55, 18, 0.85],
    "fill-extrusion-vertical-gradient": true,
  },
};

// Named label for each Adonmo project, anchored to its building volume.
// This is the ONLY building-name label the map draws: CARTO's `building`
// source-layer (see diagnosis above) carries no name property at all, so
// there is no real OSM name to show for surrounding city buildings — and
// per the brief, an absent name should stay absent rather than be invented.
// Every Adonmo project DOES have a real name in the dataset, which is the
// name that actually matters here, so this covers the requirement fully
// for the buildings the product is about.
const projectBuildingLabelLayer: LayerProps = {
  id: "project-building-labels",
  type: "symbol",
  source: "project-buildings",
  minzoom: 14.5,
  filter: ["!=", ["get", "name"], null],
  layout: {
    "text-field": ["get", "name"],
    "text-font": ["Noto Sans Bold"],
    // `feature-state` isn't valid inside `layout` (only `paint`), so "bigger
    // once you're close to a project" is driven by zoom instead — which
    // amounts to the same thing here, since only the project-level camera
    // state reaches these zooms. Selection emphasis is carried by paint
    // (color/halo) below, where feature-state is actually allowed.
    "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 10, 18, 15],
    "text-anchor": "bottom",
    "text-offset": [0, -1.3],
    "text-allow-overlap": false,
    "text-optional": true,
  },
  paint: {
    "text-color": ["case", ["boolean", ["feature-state", "selected"], false], "#3730a3", "#78716c"],
    "text-halo-color": "#ffffff",
    "text-halo-width": ["case", ["boolean", ["feature-state", "selected"], false], 2, 1.4],
  },
};

const clusterLayer: LayerProps = {
  id: "screens-clusters",
  type: "circle",
  source: "screens",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": ["step", ["get", "point_count"], "#6366f1", 25, "#4338ca", 100, "#312e81"],
    "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 28],
    "circle-stroke-width": 2,
    "circle-stroke-color": "#ffffff",
  },
};

const clusterCountLayer: LayerProps = {
  id: "screens-cluster-count",
  type: "symbol",
  source: "screens",
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count_abbreviated"],
    "text-size": 12,
    "text-font": ["Noto Sans Bold"],
  },
  paint: { "text-color": "#ffffff" },
};

// Soft halo drawn under a selected project marker so it reads clearly
// against the 3D buildings once tilted.
// MapLibre doesn't allow feature-state expressions inside `filter` (only in
// paint/layout), so "only show for the selected feature" has to be done by
// collapsing opacity/radius to 0 for everything else, not by filtering.
const selectedProjectHaloLayer: LayerProps = {
  id: "screens-point-halo",
  type: "circle",
  source: "screens",
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": "#0ea5e9",
    "circle-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.25, 0],
    "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 20, 0],
  },
};

const unclusteredLayer: LayerProps = {
  id: "screens-point",
  type: "circle",
  source: "screens",
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0ea5e9", "#f97316"],
    "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 9, 6],
    "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1.5],
    "circle-stroke-color": "#ffffff",
  },
};

// Illustrative per-screen markers, only ever mounted once a project is
// selected — see syntheticScreens.ts for why these positions are synthetic.
const screenHaloLayer: LayerProps = {
  id: "project-screens-halo",
  type: "circle",
  source: "project-screens",
  paint: {
    "circle-color": "#22d3ee",
    "circle-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.3, 0],
    "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 14, 0],
  },
};

const screenLayer: LayerProps = {
  id: "project-screens-point",
  type: "circle",
  source: "project-screens",
  paint: {
    "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0891b2", "#22d3ee"],
    "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 7, 5],
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#ffffff",
  },
};

const INTERACTIVE_LAYER_IDS = ["screens-clusters", "screens-point", "project-screens-point"];

function bboxOfFeatures(features: { geometry: { coordinates: [number, number] } }[]): Bbox | null {
  if (features.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

// Flies to a bounding box the same way `fitBounds` would, except the zoom is
// clamped to a minimum — so a geographically wide selection still lands on
// a close, obviously-3D framing instead of the flat wide shot `fitBounds`
// alone would compute. `cameraForBounds` gives the *natural* center/zoom for
// the box (accounting for the requested pitch/bearing) without moving the
// camera; only the zoom is then floored/capped before the actual flight.
function flyIntoBounds(
  map: MapLibreMap,
  bbox: Bbox,
  opts: { pitch: number; bearing: number; minZoom: number; maxZoom: number; padding: number; duration: number },
) {
  const natural = map.cameraForBounds(bbox, { padding: opts.padding, bearing: opts.bearing, pitch: opts.pitch });
  const center = natural?.center ?? [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
  const naturalZoom = natural?.zoom ?? opts.minZoom;
  const zoom = Math.min(opts.maxZoom, Math.max(opts.minZoom, naturalZoom));
  map.flyTo({ center, zoom, pitch: opts.pitch, bearing: opts.bearing, duration: opts.duration });
}

const METERS_PER_DEGREE_LAT = 110_540;

// Small square footprint centered on a project's coordinate, height derived
// from its real household count (clamped to a plausible low-rise band). See
// the comment on projectBuildingsLayer for why this exists and what it is
// (and isn't) representing.
function projectFootprint(feature: ProjectFeature) {
  const [lng, lat] = feature.geometry.coordinates;
  const households = feature.properties.households ?? 0;
  const estHeight = Math.max(9, Math.min(42, 9 + Math.sqrt(households) * 0.55));
  const dLat = PROJECT_FOOTPRINT_HALF_SIDE_METERS / METERS_PER_DEGREE_LAT;
  const dLng = PROJECT_FOOTPRINT_HALF_SIDE_METERS / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Feature" as const,
    properties: { mediaSiteId: feature.properties.mediaSiteId, name: feature.properties.name, estHeight },
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [lng - dLng, lat - dLat],
          [lng + dLng, lat - dLat],
          [lng + dLng, lat + dLat],
          [lng - dLng, lat + dLat],
          [lng - dLng, lat - dLat],
        ],
      ],
    },
  };
}

function buildProjectBuildingsFeatureCollection(fc: ScreenFeatureCollection | null) {
  if (!fc) return null;
  return { type: "FeatureCollection" as const, features: fc.features.map(projectFootprint) };
}

// Frames the project's own building volume plus its screen ring, with a
// fixed real-world margin — this is what lets project camera distance
// "adapt to project/building extent, screen extent" per the brief, instead
// of one fixed zoom for every project regardless of how many screens it has.
const PROJECT_CAMERA_PAD_METERS = 45;

function projectCameraBbox(feature: ProjectFeature, screens: SyntheticScreen[]): Bbox {
  const [lng, lat] = feature.geometry.coordinates;
  let minLng = lng;
  let maxLng = lng;
  let minLat = lat;
  let maxLat = lat;
  for (const s of screens) {
    minLng = Math.min(minLng, s.longitude);
    maxLng = Math.max(maxLng, s.longitude);
    minLat = Math.min(minLat, s.latitude);
    maxLat = Math.max(maxLat, s.latitude);
  }
  const dLat = PROJECT_CAMERA_PAD_METERS / METERS_PER_DEGREE_LAT;
  const dLng = PROJECT_CAMERA_PAD_METERS / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [minLng - dLng, minLat - dLat],
    [maxLng + dLng, maxLat + dLat],
  ];
}

function summarizeClusterLeaves(leaves: ProjectFeature[]): ClusterInfo {
  let totalScreens = 0;
  let totalHouseholds = 0;
  let totalImpressions = 0;
  let totalAdBudget = 0;
  // `Map` (the React component from react-map-gl) shadows the built-in
  // Map class at module scope, so reach it via globalThis here.
  const localityCounts = new globalThis.Map<string, number>();
  const zoneCounts = new globalThis.Map<string, number>();

  for (const f of leaves) {
    const p = f.properties;
    totalScreens += p.screens ?? 0;
    totalHouseholds += p.households ?? 0;
    totalImpressions += p.impressionsPerMonth ?? 0;
    totalAdBudget += p.monthlyAdBudget ?? 0;
    if (p.locality) localityCounts.set(p.locality, (localityCounts.get(p.locality) ?? 0) + 1);
    if (p.zone) zoneCounts.set(p.zone, (zoneCounts.get(p.zone) ?? 0) + 1);
  }

  const sortedLocalities = [...localityCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedZones = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1]);

  return {
    pointCount: leaves.length,
    totalScreens,
    totalHouseholds,
    totalImpressions,
    totalAdBudget,
    // Impressions/month is the closest metric this dataset tracks to footfall
    // (screens are placed where residents pass daily) — divide by 30 for a
    // rough daily estimate.
    dailyFootfall: Math.round(totalImpressions / 30),
    localities: sortedLocalities.slice(0, MAX_LOCALITIES_SHOWN).map(([name, count]) => ({ name, count })),
    moreLocalities: Math.max(0, sortedLocalities.length - MAX_LOCALITIES_SHOWN),
    zones: sortedZones.map(([name, count]) => ({ name, count })),
  };
}

function toProjectPanelInfo(feature: ProjectFeature, screens: SyntheticScreen[], hiddenScreenCount: number): ProjectPanelInfo {
  const p = feature.properties;
  return {
    name: p.name ?? "Untitled project",
    locality: p.locality,
    zone: p.zone,
    totalScreens: p.screens ?? 0,
    households: p.households,
    impressionsPerMonth: p.impressionsPerMonth,
    monthlyAdBudget: p.monthlyAdBudget,
    dailyFootfall: p.impressionsPerMonth != null ? Math.round(p.impressionsPerMonth / 30) : null,
    screenSizes: (p.screenSize ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    screenList: screens,
    hiddenScreenCount,
  };
}

type SelectedCluster = { info: ClusterInfo; bbox: Bbox | null };
type SelectedProject = { feature: ProjectFeature; featureId: string | number | undefined; screens: SyntheticScreen[]; hiddenScreenCount: number };

export default function InventoryMap({ cityId }: { cityId: CityId }) {
  const mapRef = useRef<MapRef>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScreenFeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const [viewLevel, setViewLevel] = useState<ViewLevel>("city");
  const [selectedCluster, setSelectedCluster] = useState<SelectedCluster | null>(null);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedScreen, setSelectedScreen] = useState<SyntheticScreen | null>(null);
  const [selectedScreenFeatureId, setSelectedScreenFeatureId] = useState<string | number | undefined>(undefined);

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  const flyToCity = (map: MapLibreMap, fc: ScreenFeatureCollection | null) => {
    const bbox = fc ? bboxOfFeatures(fc.features) : null;
    if (bbox) {
      map.fitBounds(bbox, { padding: 60, pitch: CITY_VIEW_PITCH, bearing: 0, duration: 1400, maxZoom: 15 });
    } else {
      const city = CITIES.find((c) => c.id === cityId);
      if (city) map.flyTo({ center: city.center, zoom: city.zoom, pitch: CITY_VIEW_PITCH, bearing: 0, duration: 1400 });
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setViewLevel("city");
    setSelectedCluster(null);
    setSelectedProject(null);
    setSelectedScreen(null);
    setSelectedScreenFeatureId(undefined);
    loadCityScreens(cityId).then((fc) => {
      if (cancelled) return;
      setData(fc);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  // Flying the camera to the loaded city's bounds needs BOTH the data and a
  // ready MapLibre instance. These resolve independently and in either
  // order — `loadCityScreens` is a fast local import that often beats the
  // map's own async style/tile load on first mount, so a one-shot check of
  // `mapRef.current` right after the data promise resolves used to silently
  // no-op (the map genuinely wasn't ready yet, and nothing retried it).
  // Keying an effect off both `mapReady` and `data` fires once whichever
  // one finishes last is ready, on both the first load and later switches.
  useEffect(() => {
    if (!mapReady || !data) return;
    const map = mapRef.current?.getMap();
    if (map) flyToCity(map, data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data]);

  const clearProjectHighlight = (map: MapLibreMap) => {
    if (selectedProject?.featureId != null) {
      map.setFeatureState({ source: "screens", id: selectedProject.featureId }, { selected: false });
    }
    const mediaSiteId = selectedProject?.feature.properties.mediaSiteId;
    if (mediaSiteId != null) {
      map.setFeatureState({ source: "project-buildings", id: mediaSiteId }, { selected: false });
    }
  };

  const goTo = (level: ViewLevel) => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (level === "city") {
      clearProjectHighlight(map);
      setSelectedProject(null);
      setSelectedScreen(null);
      setSelectedScreenFeatureId(undefined);
      setSelectedCluster(null);
      setViewLevel("city");
      flyToCity(map, data);
      return;
    }

    if (level === "cluster") {
      clearProjectHighlight(map);
      setSelectedProject(null);
      setSelectedScreen(null);
      setSelectedScreenFeatureId(undefined);
      setViewLevel("cluster");
      if (selectedCluster?.bbox) {
        flyIntoBounds(map, selectedCluster.bbox, {
          pitch: CLUSTER_PITCH,
          bearing: CLUSTER_BEARING,
          minZoom: CLUSTER_MIN_ZOOM,
          maxZoom: CLUSTER_MAX_ZOOM,
          padding: 90,
          duration: 1300,
        });
      }
      return;
    }

    // "project" — dropping back out of a screen, camera stays put.
    setSelectedScreen(null);
    setSelectedScreenFeatureId(undefined);
    setViewLevel("project");
  };

  const handleClusterClick = (
    map: MapLibreMap,
    f: NonNullable<MapLayerMouseEvent["features"]>[number],
    lngLat: { lng: number; lat: number },
  ) => {
    const clusterId = f.properties?.cluster_id;
    const pointCount = f.properties?.point_count as number | undefined;
    const source = map.getSource("screens") as GeoJSONSource | undefined;
    if (!source || clusterId == null || pointCount == null) return;

    clearProjectHighlight(map);
    setSelectedProject(null);
    setSelectedScreen(null);
    setSelectedScreenFeatureId(undefined);

    source.getClusterLeaves(clusterId, pointCount, 0).then((leaves) => {
      const typedLeaves = leaves as unknown as ProjectFeature[];
      const info = summarizeClusterLeaves(typedLeaves);
      const bbox = bboxOfFeatures(typedLeaves);
      setSelectedCluster({ info, bbox });
      setViewLevel("cluster");

      if (bbox) {
        flyIntoBounds(map, bbox, {
          pitch: CLUSTER_PITCH,
          bearing: CLUSTER_BEARING,
          minZoom: CLUSTER_MIN_ZOOM,
          maxZoom: CLUSTER_MAX_ZOOM,
          padding: 90,
          duration: 1600,
        });
      } else {
        map.flyTo({ center: lngLat, zoom: CLUSTER_MIN_ZOOM, pitch: CLUSTER_PITCH, bearing: CLUSTER_BEARING, duration: 1300 });
      }
    });
  };

  const handleProjectClick = (map: MapLibreMap, f: NonNullable<MapLayerMouseEvent["features"]>[number]) => {
    clearProjectHighlight(map);
    setSelectedScreen(null);
    setSelectedScreenFeatureId(undefined);

    const feature = { type: "Feature", geometry: f.geometry, properties: f.properties } as ProjectFeature;
    const { screens, hiddenCount } = generateSyntheticScreens(feature);
    const featureId = f.id;

    setSelectedProject({ feature, featureId, screens, hiddenScreenCount: hiddenCount });
    setViewLevel("project");

    if (featureId != null) {
      map.setFeatureState({ source: "screens", id: featureId }, { selected: true });
    }
    const mediaSiteId = feature.properties.mediaSiteId;
    if (mediaSiteId != null) {
      map.setFeatureState({ source: "project-buildings", id: mediaSiteId }, { selected: true });
    }

    flyIntoBounds(map, projectCameraBbox(feature, screens), {
      pitch: PROJECT_PITCH,
      bearing: PROJECT_BEARING,
      minZoom: PROJECT_MIN_ZOOM,
      maxZoom: PROJECT_MAX_ZOOM,
      padding: 70,
      duration: 1300,
    });
  };

  const handleScreenClick = (map: MapLibreMap, f: NonNullable<MapLayerMouseEvent["features"]>[number]) => {
    if (selectedScreenFeatureId != null) {
      map.setFeatureState({ source: "project-screens", id: selectedScreenFeatureId }, { selected: false });
    }
    const screen = selectedProject?.screens.find((s) => s.id === f.properties?.screenId);
    if (!screen) return;
    setSelectedScreen(screen);
    setSelectedScreenFeatureId(f.id);
    setViewLevel("screen");
    if (f.id != null) {
      map.setFeatureState({ source: "project-screens", id: f.id }, { selected: true });
    }
  };

  const handleMapClick = (e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap();
    const f = e.features?.[0];
    if (!f || !map) {
      // An empty-space click just drops a screen selection, if any — it
      // shouldn't yank the camera back on an accidental background click.
      if (selectedScreen) goTo("project");
      return;
    }

    if (f.layer?.id === "screens-clusters") {
      handleClusterClick(map, f, e.lngLat);
      return;
    }
    if (f.layer?.id === "screens-point") {
      handleProjectClick(map, f);
      return;
    }
    if (f.layer?.id === "project-screens-point") {
      handleScreenClick(map, f);
    }
  };

  const screensFeatureCollection = useMemo(
    () => (selectedProject ? screensToFeatureCollection(selectedProject.screens) : null),
    [selectedProject],
  );

  const projectBuildingsFeatureCollection = useMemo(() => buildProjectBuildingsFeatureCollection(data), [data]);

  const projectPanelInfo = selectedProject
    ? toProjectPanelInfo(selectedProject.feature, selectedProject.screens, selectedProject.hiddenScreenCount)
    : null;

  const crumbs = useMemo(() => {
    const list: { label: string; level: ViewLevel }[] = [{ label: cityLabel, level: "city" }];
    if (selectedCluster) list.push({ label: `${selectedCluster.info.pointCount} sites`, level: "cluster" });
    if (projectPanelInfo) list.push({ label: projectPanelInfo.name, level: "project" });
    if (selectedScreen) list.push({ label: selectedScreen.id, level: "screen" });
    return list;
  }, [cityLabel, selectedCluster, projectPanelInfo, selectedScreen]);

  const inspectorContent =
    viewLevel === "screen" && selectedScreen && projectPanelInfo
      ? ({ kind: "screen", screen: selectedScreen, project: projectPanelInfo } as const)
      : viewLevel === "project" && projectPanelInfo
        ? ({ kind: "project", project: projectPanelInfo } as const)
        : viewLevel === "cluster" && selectedCluster
          ? ({ kind: "cluster", cluster: selectedCluster.info } as const)
          : null;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: CITIES[0].center[0],
          latitude: CITIES[0].center[1],
          zoom: CITIES[0].zoom,
          pitch: CITY_VIEW_PITCH,
          bearing: 0,
        }}
        mapStyle={STYLE_URL}
        interactiveLayerIds={INTERACTIVE_LAYER_IDS}
        onClick={handleMapClick}
        onLoad={() => setMapReady(true)}
        onError={(e: ErrorEvent) => {
          console.error("[InventoryMap] MapLibre error:", e.error);
          setError(e.error?.message ?? "Unknown map error — check the console.");
        }}
      >
        <NavigationControl position="top-right" visualizePitch />
        <Layer {...parkCanopyLayer} beforeId={LABEL_LAYER_ID} />
        <Layer {...buildingsLayer} beforeId={LABEL_LAYER_ID} />

        {projectBuildingsFeatureCollection && (
          <Source
            id="project-buildings"
            type="geojson"
            data={projectBuildingsFeatureCollection}
            promoteId="mediaSiteId"
          >
            <Layer {...projectBuildingsLayer} beforeId={LABEL_LAYER_ID} />
            <Layer {...projectBuildingLabelLayer} />
          </Source>
        )}

        {data && (
          <Source
            id="screens"
            type="geojson"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={data as any}
            cluster
            clusterMaxZoom={14}
            clusterRadius={50}
            generateId
          >
            <Layer {...clusterLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...selectedProjectHaloLayer} />
            <Layer {...unclusteredLayer} />
          </Source>
        )}

        {screensFeatureCollection && (
          <Source id="project-screens" type="geojson" data={screensFeatureCollection} generateId>
            <Layer {...screenHaloLayer} />
            <Layer {...screenLayer} />
          </Source>
        )}
      </Map>

      {loading && <div className="inventory-status">Loading inventory…</div>}
      {error && <div className="inventory-error">Map error: {error}</div>}
      <div className="inventory-caption">
        3D building heights are illustrative — most structures aren't surveyed for height in OpenStreetMap.
        Indigo volumes mark Adonmo project sites; gray are surrounding city buildings.
      </div>

      <InspectorPanel
        content={inspectorContent}
        crumbs={crumbs}
        selectedScreenId={selectedScreen?.id ?? null}
        onNavigate={goTo}
        onClose={() => goTo("city")}
        onSelectScreen={(screenId) => {
          const map = mapRef.current?.getMap();
          const screen = selectedProject?.screens.find((s) => s.id === screenId);
          if (!map || !screen) return;
          // Selecting from the list mirrors clicking the marker directly —
          // find its rendered feature id so the map highlight stays in sync.
          const rendered = map.queryRenderedFeatures(undefined, { layers: ["project-screens-point"] }) as unknown as
            | { id?: string | number; properties?: { screenId?: string } }[]
            | undefined;
          const match = rendered?.find((rf) => rf.properties?.screenId === screenId);
          if (selectedScreenFeatureId != null) {
            map.setFeatureState({ source: "project-screens", id: selectedScreenFeatureId }, { selected: false });
          }
          setSelectedScreen(screen);
          setSelectedScreenFeatureId(match?.id);
          setViewLevel("screen");
          if (match?.id != null) {
            map.setFeatureState({ source: "project-screens", id: match.id }, { selected: true });
          }
        }}
      />
    </div>
  );
}
