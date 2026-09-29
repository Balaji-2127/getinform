import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CITIES, loadCityScreens, type CityId, type ScreenFeatureCollection } from "./data/cities";
import InspectorPanel, { type ClusterInfo, type ProjectPanelInfo, type ViewLevel } from "./InspectorPanel";
import CampaignBanner, { type CampaignSummary } from "./CampaignBanner";
import MapLegend from "./MapLegend";
import { generateSyntheticScreens, type SyntheticScreen } from "./syntheticScreens";
import { initMapbox } from "./mapbox/loadMapbox";
import {
  buildClusterIndex,
  getLeavesAsFeatures,
  toClusterOrPoint,
  WORLD_BBOX,
  type ProjectFeature,
} from "./google/clustering";
import { bboxOfPoints, type Bbox } from "./google/cameraMath";
import "./MapboxInventoryMap.css";

// ---------------------------------------------------------------------------
// Second, independent map engine (Mapbox GL) rendering the exact same
// campaign/inventory data as GoogleInventoryMap — kept fully separate so the
// working Google 3D map is never at risk. The data layer (data/cities.ts),
// clustering (google/clustering.ts — pure supercluster geometry, nothing
// Google-specific despite the folder name), and UI chrome (InspectorPanel,
// CampaignBanner, MapLegend, CitySidebar) are all shared as-is; only the
// actual map-rendering/marker code below is engine-specific.
//
// Mapbox has no "range" (distance) camera model like Google's Map3DElement
// — it's zoom-level based, and map.fitBounds() computes the right zoom for
// a bounding box on its own, which is considerably simpler than the manual
// range math cameraMath.ts has for the Google build.
// ---------------------------------------------------------------------------
const CITY_PITCH = 45;
const CITY_BEARING = 0;
const CITY_ZOOM_FALLBACK = 11;

const CLUSTER_PITCH = 55;
const CLUSTER_BEARING = -20;

const PROJECT_PITCH = 60;
const PROJECT_BEARING = 25;
const PROJECT_ZOOM = 17.5;

const CITY_BIN_ZOOM = 10; // supercluster's own abstract binning zoom, unrelated to the map's zoom.
const MAX_LOCALITIES_SHOWN = 6;
const EXPAND_LEAVES_THRESHOLD = 40;
const TOUR_DWELL_MS = 4800;

function clusterMarkerStyle(pointCount: number): { background: string; size: number } {
  if (pointCount >= 100) return { background: "#6b7280", size: 40 };
  if (pointCount >= 25) return { background: "#9ca3af", size: 34 };
  return { background: "#d1d5db", size: 28 };
}

const PROJECT_COLOR = "#111827";
const PROJECT_SELECTED_COLOR = "#0ea5e9";
const PROJECT_SIZE = 20;
const PROJECT_SELECTED_SIZE = 26;
const SCREEN_COLOR = "#22d3ee";
const SCREEN_SELECTED_COLOR = "#0891b2";
const SCREEN_SIZE = 12;
const SCREEN_SELECTED_SIZE = 18;

const CAMPAIGN_HIGHLIGHT_COLOR = "#2563eb";
const CAMPAIGN_HIGHLIGHT_SIZE = 30;
const CAMPAIGN_DIM_COLOR = "#9ca3af";
const CAMPAIGN_DIM_SIZE = 16;

const PULSE_PERIOD_MS = 1400;
const PULSE_AMPLITUDE = 0.16;
const PULSE_SELECTED_AMPLITUDE = 0.24;
const PULSE_HIGHLIGHT_AMPLITUDE = 0.3;
const PULSE_DIM_AMPLITUDE = 0;
const PULSE_MIN_FRAME_MS = 33;

function summarizeClusterLeaves(leaves: ProjectFeature[]): ClusterInfo {
  let totalScreens = 0;
  let totalHouseholds = 0;
  let totalImpressions = 0;
  let totalAdBudget = 0;
  const localityCounts = new Map<string, number>();
  const zoneCounts = new Map<string, number>();

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
    visualLink: p.visualLink,
  };
}

function projectKey(feature: ProjectFeature): string {
  return feature.properties.mediaSiteId ?? `${feature.geometry.coordinates[0]},${feature.geometry.coordinates[1]}`;
}

function makeMarkerEl(opts: { background: string; size: number; glyphText?: string; borderColor?: string }): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "mb-pin";
  el.style.width = `${opts.size}px`;
  el.style.height = `${opts.size}px`;
  el.style.background = opts.background;
  el.style.borderColor = opts.borderColor ?? "#ffffff";
  if (opts.glyphText) {
    el.textContent = opts.glyphText;
    el.style.fontSize = `${Math.max(9, opts.size * 0.36)}px`;
  }
  return el;
}

type SelectedCluster = { info: ClusterInfo; leaves: ProjectFeature[] };
type SelectedProject = { feature: ProjectFeature; screens: SyntheticScreen[]; hiddenScreenCount: number };
type MarkerPin = { marker: mapboxgl.Marker; el: HTMLDivElement };
// restColor/restSize are the pin's resting state (rest = "not selected") —
// the pulse loop reads pulseAmplitude and applies a CSS transform on top of
// whatever width/height is currently set, so selection state only ever
// needs to write width/height/background directly, never a separate scale
// field the way the Google build's PinElement.scale needed one.
type ProjectMarkerEntry = MarkerPin & {
  feature: ProjectFeature;
  restColor: string;
  restSize: number;
  pulseAmplitude: number;
};

export default function MapboxInventoryMap({
  cityId,
  highlightedMediaSiteIds,
  campaignLabel,
  highlightLabel,
}: {
  cityId: CityId;
  highlightedMediaSiteIds?: Set<string>;
  campaignLabel?: string;
  highlightLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const levelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const projectMarkersRef = useRef<globalThis.Map<string, ProjectMarkerEntry>>(new globalThis.Map());
  const screenMarkersRef = useRef<globalThis.Map<string, MarkerPin & { projectFeature: ProjectFeature; screen: SyntheticScreen }>>(new globalThis.Map());
  const selectedProjectMarkerRef = useRef<ProjectMarkerEntry | null>(null);
  const selectedScreenMarkerRef = useRef<MarkerPin | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const clusterIndexRef = useRef<ReturnType<typeof buildClusterIndex> | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScreenFeatureCollection | null>(null);

  const [viewLevel, setViewLevel] = useState<ViewLevel>("city");
  const [selectedCluster, setSelectedCluster] = useState<SelectedCluster | null>(null);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedScreen, setSelectedScreen] = useState<SyntheticScreen | null>(null);
  const [showInventory, setShowInventory] = useState(true);

  const [touring, setTouring] = useState(false);
  const [tourProgress, setTourProgress] = useState<{ current: number; total: number } | null>(null);
  const [tourPause, setTourPause] = useState<{ index: number; total: number } | null>(null);
  const tourTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tourAdvancingRef = useRef(false);

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  useEffect(() => {
    return () => {
      if (tourTimeoutRef.current != null) {
        clearTimeout(tourTimeoutRef.current);
        tourTimeoutRef.current = null;
      }
      setTouring(false);
      setTourProgress(null);
      setTourPause(null);
    };
  }, [cityId]);

  // ---- one-time map bootstrap -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    // Captured directly, not read back via mapRef — mapRef is only set once
    // the map's "load" event fires, but React's StrictMode runs this
    // effect's cleanup immediately after its first mount (dev only), well
    // before "load" has any chance to fire. Cleaning up via mapRef in that
    // window would do nothing, leaving the first map instance's DOM/canvas
    // orphaned inside the container when the second mount creates another
    // one — exactly the "map container should be empty" warning this fixes.
    let map: mapboxgl.Map | null = null;
    try {
      const mb = initMapbox();
      if (!containerRef.current) return;
      const instance = new mb.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [CITIES[0].center[0], CITIES[0].center[1]],
        zoom: CITY_ZOOM_FALLBACK,
        pitch: CITY_PITCH,
        bearing: CITY_BEARING,
        antialias: true,
      });
      map = instance; // for cleanup only — everything else below uses the stable `instance` const so closures narrow correctly.
      instance.addControl(new mb.NavigationControl({ visualizePitch: true }), "bottom-right");
      instance.on("click", () => {
        stopTour();
        setSelectedScreen((current) => (current ? null : current));
        setViewLevel((level) => (level === "screen" ? "project" : level));
      });
      instance.on("load", () => {
        if (cancelled) return;
        // Hide every symbol layer from the base style — Mapbox's own place
        // names (cities, neighborhoods/localities), POI icons and labels,
        // road labels, transit stops, all of it. None of that is ours, and
        // symbol placement/label collision is one of the more expensive
        // parts of the render pipeline, so this helps performance too, not
        // just declutters. Only geometry (roads, buildings, land, water)
        // plus our own markers remain.
        const style = instance.getStyle();
        const layers = style?.layers ?? [];
        for (const layer of layers) {
          if (layer.type === "symbol") instance.setLayoutProperty(layer.id, "visibility", "none");
        }

        // Explicit 3D building extrusion — light-v11's own building layer
        // doesn't reliably extrude at the zoom levels this app actually
        // uses, so this adds one directly rather than assuming the base
        // style handles it. Standard Mapbox pattern: classic styles
        // (light-v11 included) all serve building footprints from the
        // "composite" source's "building" source-layer, with an "extrude"
        // property on buildings tall enough to bother extruding.
        if (instance.getSource("composite") && !instance.getLayer("3d-buildings")) {
          const firstSymbolLayerId = layers.find((l) => l.type === "symbol")?.id;
          instance.addLayer(
            {
              id: "3d-buildings",
              source: "composite",
              "source-layer": "building",
              filter: ["==", "extrude", "true"],
              type: "fill-extrusion",
              minzoom: 13,
              paint: {
                "fill-extrusion-color": "#d1d5db",
                "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ["get", "height"]],
                "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ["get", "min_height"]],
                "fill-extrusion-opacity": 0.85,
              },
            },
            firstSymbolLayerId,
          );
        }

        mapRef.current = instance;
        setMapReady(true);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- project pin pulse animation --------------------------------------
  useEffect(() => {
    let lastFrameTime = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastFrameTime >= PULSE_MIN_FRAME_MS) {
        lastFrameTime = timestamp;
        const phase = ((timestamp % PULSE_PERIOD_MS) / PULSE_PERIOD_MS) * Math.PI * 2;
        const wave = Math.sin(phase);
        const selected = selectedProjectMarkerRef.current;
        for (const entry of projectMarkersRef.current.values()) {
          const amplitude = entry === selected ? PULSE_SELECTED_AMPLITUDE : entry.pulseAmplitude;
          const scale = 1 + amplitude * wave;
          entry.el.style.transform = `scale(${scale})`;
        }
      }
      pulseRafRef.current = requestAnimationFrame(tick);
    };
    pulseRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current);
    };
  }, []);

  // ---- load city data -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setViewLevel("city");
    setSelectedCluster(null);
    setSelectedProject(null);
    setSelectedScreen(null);
    loadCityScreens(cityId).then((fc) => {
      if (cancelled) return;
      setData(fc);
      const clusterable =
        highlightedMediaSiteIds && highlightedMediaSiteIds.size > 0
          ? { ...fc, features: fc.features.filter((f) => !(f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId))) }
          : fc;
      clusterIndexRef.current = buildClusterIndex(clusterable);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  const clearLevelMarkers = () => {
    for (const m of levelMarkersRef.current) m.remove();
    levelMarkersRef.current = [];
    projectMarkersRef.current.clear();
    screenMarkersRef.current.clear();
    selectedProjectMarkerRef.current = null;
    selectedScreenMarkerRef.current = null;
  };
  // Screens are only ever rendered for whichever single project is
  // currently selected (see selectProject) — this swaps them out when
  // selection moves to a different project, without touching the rest of
  // the currently-rendered level (clusters/other project pins stay put).
  const clearProjectScreenMarkers = () => {
    const removed = new Set<mapboxgl.Marker>();
    for (const entry of screenMarkersRef.current.values()) {
      entry.marker.remove();
      removed.add(entry.marker);
    }
    screenMarkersRef.current.clear();
    levelMarkersRef.current = levelMarkersRef.current.filter((m) => !removed.has(m));
  };
  const clearScreenSelection = () => {
    if (selectedScreenMarkerRef.current) {
      selectedScreenMarkerRef.current.el.style.background = SCREEN_COLOR;
      selectedScreenMarkerRef.current.el.style.width = `${SCREEN_SIZE}px`;
      selectedScreenMarkerRef.current.el.style.height = `${SCREEN_SIZE}px`;
      selectedScreenMarkerRef.current = null;
    }
  };
  const clearProjectHighlight = () => {
    const sel = selectedProjectMarkerRef.current;
    if (sel) {
      sel.el.style.background = sel.restColor;
      sel.el.style.width = `${sel.restSize}px`;
      sel.el.style.height = `${sel.restSize}px`;
    }
    selectedProjectMarkerRef.current = null;
  };

  const flyTo = (opts: { lat: number; lng: number; zoom: number; pitch: number; bearing: number; duration?: number }) => {
    mapRef.current?.flyTo({
      center: [opts.lng, opts.lat],
      zoom: opts.zoom,
      pitch: opts.pitch,
      bearing: opts.bearing,
      duration: opts.duration ?? 1300,
      essential: true,
    });
  };

  const fitToBbox = (bbox: Bbox, opts: { pitch: number; bearing: number; duration?: number; maxZoom?: number }) => {
    mapRef.current?.fitBounds(bbox as mapboxgl.LngLatBoundsLike, {
      padding: 90,
      pitch: opts.pitch,
      bearing: opts.bearing,
      duration: opts.duration ?? 1400,
      maxZoom: opts.maxZoom ?? 16,
      essential: true,
    });
  };

  const flyToCity = (fc: ScreenFeatureCollection | null) => {
    const highlighted =
      highlightedMediaSiteIds && highlightedMediaSiteIds.size > 0
        ? (fc?.features ?? []).filter((f) => f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId))
        : [];
    const relevant = highlighted.length > 0 ? highlighted : (fc?.features ?? []);
    const points = relevant.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
    const bbox = bboxOfPoints(points);
    if (bbox) {
      fitToBbox(bbox, highlighted.length > 0 ? { pitch: CLUSTER_PITCH, bearing: CLUSTER_BEARING, maxZoom: 15 } : { pitch: CITY_PITCH, bearing: CITY_BEARING, maxZoom: 12 });
    } else {
      const city = CITIES.find((c) => c.id === cityId);
      if (city) flyTo({ lat: city.center[1], lng: city.center[0], zoom: CITY_ZOOM_FALLBACK, pitch: CITY_PITCH, bearing: CITY_BEARING, duration: 1600 });
    }
  };

  const clearTourTimer = () => {
    if (tourTimeoutRef.current != null) {
      clearTimeout(tourTimeoutRef.current);
      tourTimeoutRef.current = null;
    }
  };
  const endTour = () => {
    clearTourTimer();
    setTouring(false);
    setTourProgress(null);
    setTourPause(null);
  };
  const stopTour = () => {
    clearTourTimer();
    if (touring && tourProgress) {
      setTourPause({ index: tourProgress.current - 1, total: tourProgress.total });
    }
    setTouring(false);
    setTourProgress(null);
  };

  const selectProject = (entry: ProjectMarkerEntry) => {
    if (!tourAdvancingRef.current) stopTour();
    clearProjectHighlight();
    entry.el.style.background = PROJECT_SELECTED_COLOR;
    entry.el.style.width = `${PROJECT_SELECTED_SIZE}px`;
    entry.el.style.height = `${PROJECT_SELECTED_SIZE}px`;
    selectedProjectMarkerRef.current = entry;

    const { feature } = entry;
    clearProjectScreenMarkers();
    const { screens, hiddenCount } = generateSyntheticScreens(feature);
    renderScreenMarkers(feature, screens);
    setSelectedProject({ feature, screens, hiddenScreenCount: hiddenCount });
    setSelectedScreen(null);
    setViewLevel("project");
    clearScreenSelection();

    const [lng, lat] = feature.geometry.coordinates;
    flyTo({ lat, lng, zoom: PROJECT_ZOOM, pitch: PROJECT_PITCH, bearing: PROJECT_BEARING, duration: 1300 });
  };

  const selectScreenById = (screenId: string) => {
    const entry = screenMarkersRef.current.get(screenId);
    if (!entry) return;
    stopTour();

    const wantedKey = projectKey(entry.projectFeature);
    const currentKey = selectedProject ? projectKey(selectedProject.feature) : null;
    if (wantedKey !== currentKey) {
      const projEntry = projectMarkersRef.current.get(wantedKey);
      if (projEntry) selectProject(projEntry);
    }

    clearScreenSelection();
    entry.el.style.background = SCREEN_SELECTED_COLOR;
    entry.el.style.width = `${SCREEN_SELECTED_SIZE}px`;
    entry.el.style.height = `${SCREEN_SELECTED_SIZE}px`;
    selectedScreenMarkerRef.current = entry;
    setSelectedScreen(entry.screen);
    setViewLevel("screen");
  };

  // Screen markers for one project only — called from selectProject, not
  // from bulk rendering. A cluster expansion can put up to
  // EXPAND_LEAVES_THRESHOLD (40) project pins on screen at once; eagerly
  // creating every one of their screens too (each project can have up to
  // VISUAL_SCREEN_CAP synthetic screens) meant hundreds of real DOM marker
  // elements created in a single pass, which is exactly what was making
  // the map feel slow. Screens now only exist for whichever project is
  // actually selected.
  const renderScreenMarkers = (feature: ProjectFeature, screens: SyntheticScreen[]) => {
    const map = mapRef.current;
    if (!map) return;
    for (const s of screens) {
      const sEl = makeMarkerEl({ background: SCREEN_COLOR, size: SCREEN_SIZE });
      const sMarker = new mapboxgl.Marker({ element: sEl, anchor: "center" }).setLngLat([s.longitude, s.latitude]).addTo(map);
      sEl.addEventListener("click", (e) => {
        e.stopPropagation();
        selectScreenById(s.id);
      });
      levelMarkersRef.current.push(sMarker);
      screenMarkersRef.current.set(s.id, { marker: sMarker, el: sEl, projectFeature: feature, screen: s });
    }
  };

  const renderProjectMarker = (feature: ProjectFeature) => {
    const map = mapRef.current;
    if (!map) return;

    const [lng, lat] = feature.geometry.coordinates;
    let restColor: string = PROJECT_COLOR;
    let restSize = PROJECT_SIZE;
    let pulseAmplitude = PULSE_AMPLITUDE;
    let isHighlighted = false;
    if (highlightedMediaSiteIds) {
      isHighlighted = feature.properties.mediaSiteId != null && highlightedMediaSiteIds.has(feature.properties.mediaSiteId);
      restColor = isHighlighted ? CAMPAIGN_HIGHLIGHT_COLOR : CAMPAIGN_DIM_COLOR;
      restSize = isHighlighted ? CAMPAIGN_HIGHLIGHT_SIZE : CAMPAIGN_DIM_SIZE;
      pulseAmplitude = isHighlighted ? PULSE_HIGHLIGHT_AMPLITUDE : PULSE_DIM_AMPLITUDE;
    }

    const el = makeMarkerEl({ background: restColor, size: restSize });
    el.title = feature.properties.name ?? "";
    const marker = new mapboxgl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
    const entry: ProjectMarkerEntry = { marker, el, feature, restColor, restSize, pulseAmplitude };
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectProject(entry);
    });
    levelMarkersRef.current.push(marker);
    projectMarkersRef.current.set(projectKey(feature), entry);
  };

  const renderLevel = (items: ReturnType<typeof toClusterOrPoint>[]) => {
    const map = mapRef.current;
    if (!map) return;
    clearLevelMarkers();

    for (const item of items) {
      if (item.kind === "cluster") {
        const style = clusterMarkerStyle(item.pointCount);
        const el = makeMarkerEl({ background: style.background, size: style.size, glyphText: String(item.pointCount), borderColor: "#ffffff" });
        const marker = new mapboxgl.Marker({ element: el, anchor: "center" }).setLngLat([item.longitude, item.latitude]).addTo(map);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          handleClusterClick(item.id);
        });
        levelMarkersRef.current.push(marker);
      } else {
        renderProjectMarker(item.feature);
      }
    }
  };

  const toPointItem = (f: ProjectFeature) => ({
    kind: "point" as const,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    feature: f,
  });

  const highlightedProjectItems = () => {
    if (!highlightedMediaSiteIds || highlightedMediaSiteIds.size === 0 || !data) return [];
    return data.features
      .filter((f) => f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId))
      .map(toPointItem);
  };

  const cityLevelItems = (show: boolean = showInventory) => {
    if (!show || !clusterIndexRef.current) return [];
    return clusterIndexRef.current.getClusters(WORLD_BBOX, CITY_BIN_ZOOM).map(toClusterOrPoint);
  };

  const toggleInventory = () => {
    const next = !showInventory;
    setShowInventory(next);
    stopTour();
    clearProjectHighlight();
    clearScreenSelection();
    setSelectedProject(null);
    setSelectedScreen(null);
    setSelectedCluster(null);
    setViewLevel("city");
    renderLevel([...highlightedProjectItems(), ...cityLevelItems(next)]);
  };

  const startTour = (fromIndex: number) => {
    const items = highlightedProjectItems();
    if (items.length === 0) return;
    clearTourTimer();
    setTouring(true);
    setTourPause(null);

    let i = fromIndex;
    const step = () => {
      const item = items[i];
      const entry = projectMarkersRef.current.get(projectKey(item.feature));
      if (!entry) {
        endTour();
        return;
      }
      tourAdvancingRef.current = true;
      selectProject(entry);
      tourAdvancingRef.current = false;
      setTourProgress({ current: i + 1, total: items.length });
      i += 1;
      tourTimeoutRef.current = setTimeout(i < items.length ? step : endTour, TOUR_DWELL_MS);
    };
    step();
  };

  const handleClusterClick = (clusterId: number) => {
    const index = clusterIndexRef.current;
    if (!index) return;
    stopTour();
    const leaves = getLeavesAsFeatures(index, clusterId);
    const info = summarizeClusterLeaves(leaves);
    setSelectedCluster({ info, leaves });
    setSelectedProject(null);
    setSelectedScreen(null);
    setViewLevel("cluster");

    const bbox = bboxOfPoints(leaves.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
    if (bbox) fitToBbox(bbox, { pitch: CLUSTER_PITCH, bearing: CLUSTER_BEARING, maxZoom: 17 });

    const rest = leaves.length <= EXPAND_LEAVES_THRESHOLD ? leaves.map(toPointItem) : index.getChildren(clusterId).map(toClusterOrPoint);
    renderLevel([...highlightedProjectItems(), ...rest]);
  };

  useEffect(() => {
    if (!mapReady || !data || !clusterIndexRef.current) return;
    renderLevel([...highlightedProjectItems(), ...cityLevelItems()]);
    flyToCity(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data]);

  const projectPanelInfo = selectedProject ? toProjectPanelInfo(selectedProject.feature, selectedProject.screens, selectedProject.hiddenScreenCount) : null;

  const crumbs = useMemo(() => {
    const list: { label: string; level: ViewLevel }[] = [{ label: cityLabel, level: "city" }];
    if (selectedCluster) list.push({ label: `${selectedCluster.info.pointCount} sites`, level: "cluster" });
    if (projectPanelInfo) list.push({ label: projectPanelInfo.name, level: "project" });
    if (selectedScreen) list.push({ label: selectedScreen.id, level: "screen" });
    return list;
  }, [cityLabel, selectedCluster, projectPanelInfo, selectedScreen]);

  const campaignSummary: CampaignSummary | null = useMemo(() => {
    if (!highlightedMediaSiteIds || highlightedMediaSiteIds.size === 0 || !data) return null;
    const matched = data.features.filter((f) => f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId));
    if (matched.length === 0) return null;
    return { label: campaignLabel ?? "Campaign", ...summarizeClusterLeaves(matched) };
  }, [data, highlightedMediaSiteIds, campaignLabel]);

  const inspectorContent =
    viewLevel === "screen" && selectedScreen && projectPanelInfo
      ? ({ kind: "screen", screen: selectedScreen, project: projectPanelInfo } as const)
      : viewLevel === "project" && projectPanelInfo
        ? ({ kind: "project", project: projectPanelInfo } as const)
        : viewLevel === "cluster" && selectedCluster
          ? ({ kind: "cluster", cluster: selectedCluster.info } as const)
          : null;

  const goTo = (level: ViewLevel) => {
    stopTour();
    if (level === "city") {
      setSelectedProject(null);
      setSelectedScreen(null);
      setSelectedCluster(null);
      setViewLevel("city");
      renderLevel([...highlightedProjectItems(), ...cityLevelItems()]);
      flyToCity(data);
      return;
    }
    if (level === "cluster") {
      clearProjectHighlight();
      clearScreenSelection();
      clearProjectScreenMarkers();
      setSelectedProject(null);
      setSelectedScreen(null);
      setViewLevel("cluster");
      if (selectedCluster) {
        const bbox = bboxOfPoints(selectedCluster.leaves.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
        if (bbox) fitToBbox(bbox, { pitch: CLUSTER_PITCH, bearing: CLUSTER_BEARING, duration: 1300, maxZoom: 17 });
      }
      return;
    }
    setSelectedScreen(null);
    setViewLevel("project");
    clearScreenSelection();
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {loading && (
        <div className="inventory-loading">
          <span className="inventory-loading-spinner" />
          Loading inventory…
        </div>
      )}
      {error && <div className="inventory-error">Map error: {error}</div>}

      <CampaignBanner
        summary={campaignSummary}
        touring={touring}
        tourProgress={tourProgress}
        tourPause={tourPause}
        onStartTour={() => startTour(0)}
        onResumeTour={() => tourPause && startTour(tourPause.index)}
        onStopTour={stopTour}
      />
      <MapLegend highlightLabel={highlightLabel} showInventory={showInventory} onToggleInventory={toggleInventory} />

      <InspectorPanel content={inspectorContent} crumbs={crumbs} onNavigate={goTo} onClose={() => goTo("city")} />
    </div>
  );
}
