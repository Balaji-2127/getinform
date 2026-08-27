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
// ---------------------------------------------------------------------------
const CITY_VIEW_PITCH = 45;
const CLUSTER_PITCH = 58;
const CLUSTER_BEARING = -12;
const PROJECT_PITCH = 65;
const PROJECT_BEARING = 18;
const PROJECT_ZOOM = 17.6;

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const LABEL_LAYER_ID = "waterway_label";
const MAX_LOCALITIES_SHOWN = 6;

const buildingsLayer: LayerProps = {
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
    // Buildings get more prominent as the user drills toward a single
    // project, per the "3D building: prominent" project-level camera state.
    "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.25, 16, 0.45, 18, 0.65],
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
      const map = mapRef.current?.getMap();
      if (map) flyToCity(map, fc);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  const clearProjectHighlight = (map: MapLibreMap) => {
    if (selectedProject?.featureId != null) {
      map.setFeatureState({ source: "screens", id: selectedProject.featureId }, { selected: false });
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
        map.fitBounds(selectedCluster.bbox, {
          padding: 90,
          pitch: CLUSTER_PITCH,
          bearing: CLUSTER_BEARING,
          duration: 1300,
          maxZoom: 17,
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
        map.fitBounds(bbox, { padding: 90, pitch: CLUSTER_PITCH, bearing: CLUSTER_BEARING, duration: 1600, maxZoom: 17 });
      } else {
        map.flyTo({ center: lngLat, zoom: 16, pitch: CLUSTER_PITCH, bearing: CLUSTER_BEARING, duration: 1300 });
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

    const [lng, lat] = feature.geometry.coordinates;
    map.flyTo({ center: [lng, lat], zoom: PROJECT_ZOOM, pitch: PROJECT_PITCH, bearing: PROJECT_BEARING, duration: 1300 });
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
        onError={(e: ErrorEvent) => {
          console.error("[InventoryMap] MapLibre error:", e.error);
          setError(e.error?.message ?? "Unknown map error — check the console.");
        }}
      >
        <NavigationControl position="top-right" visualizePitch />
        <Layer {...buildingsLayer} beforeId={LABEL_LAYER_ID} />

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
