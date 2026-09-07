import { useEffect, useMemo, useRef, useState } from "react";
import { CITIES, loadCityScreens, type CityId, type ScreenFeatureCollection } from "./data/cities";
import InspectorPanel, { type ClusterInfo, type ProjectPanelInfo, type ViewLevel } from "./InspectorPanel";
import { generateSyntheticScreens, type SyntheticScreen } from "./syntheticScreens";
import { loadMaps3d } from "./google/loadGoogleMaps";
import {
  buildClusterIndex,
  getLeavesAsFeatures,
  toClusterOrPoint,
  WORLD_BBOX,
  type ProjectFeature,
} from "./google/clustering";
import { bboxCenter, bboxOfPoints, rangeForBbox, type Bbox } from "./google/cameraMath";
import "./GoogleInventoryMap.css";

// ---------------------------------------------------------------------------
// Camera states. Google's Map3DElement camera is distance-based (range, in
// meters) rather than zoom-level based like the previous MapLibre build, so
// these aren't directly ported numbers — a fresh empirical pass, tuned by
// looking at the actual rendered result.
// ---------------------------------------------------------------------------
const CITY_TILT = 45;
const CITY_HEADING = 0;
const CITY_RANGE_FACTOR = 0.85;
const CITY_MIN_RANGE = 8000;
const CITY_MAX_RANGE = 70000;

const CLUSTER_TILT = 55;
const CLUSTER_HEADING = -25;
const CLUSTER_RANGE_FACTOR = 1.0;
const CLUSTER_MIN_RANGE = 350;
const CLUSTER_MAX_RANGE = 3000;

const PROJECT_TILT = 62;
const PROJECT_HEADING = 30;
const PROJECT_RANGE = 220;

const CITY_BIN_ZOOM = 10; // supercluster's abstract binning zoom for the initial city-level query.
const MAX_LOCALITIES_SHOWN = 6;

// ---------------------------------------------------------------------------
// ROOT CAUSE of "some project pins don't highlight": every Marker3DElement
// defaults to altitudeMode CLAMP_TO_GROUND + drawsWhenOccluded false. At
// ground level our pins sit in the exact same visual plane as Google's own
// building meshes and POI icons — whichever one the renderer happens to
// paint on top, at that particular camera angle and whatever's nearby,
// wins. That's an inherent property of ground-level placement, not
// something tunable per marker — which is exactly why it looked
// inconsistent (fine for some projects, invisible for others) rather than
// uniformly broken.
//
// Fix: elevate every one of OUR markers above their surroundings
// (RELATIVE_TO_GROUND altitude), extrude a thin connector line down to the
// real ground point (so elevation doesn't cost spatial precision — you can
// still see exactly which building it's anchored to), and set
// drawsWhenOccluded so it renders even in the rare case something still
// gets between the camera and the raised pin. Applied uniformly to every
// marker type we draw, not case-by-case — the whole point is no project
// should ever need this diagnosed again.
// ---------------------------------------------------------------------------
const MARKER_ALTITUDE_MODE = "RELATIVE_TO_GROUND" as google.maps.maps3d.AltitudeModeString;
const CLUSTER_MARKER_ALTITUDE = 90; // city/cluster views are seen from far away — clear any skyline.
const PROJECT_MARKER_ALTITUDE = 45; // above typical Hyderabad low/mid-rise residential buildings.
const SCREEN_MARKER_ALTITUDE = 14; // low enough to still read as "on the building", clear of its own roofline.

// A cluster this small or smaller skips supercluster's one-level-at-a-time
// sub-cluster breakdown entirely: it expands straight to every individual
// project *and* draws each project's screens immediately, so the user sees
// real inventory detail on the first click instead of having to keep
// clicking through nested sub-clusters. Bigger clusters still drill one
// level at a time — rendering, say, a 400-site cluster's ~1,500+ screens
// all at once wouldn't be readable or fast, and a couple more clicks
// naturally lands on a small-enough group anyway.
const EXPAND_LEAVES_THRESHOLD = 40;

function summarizeClusterLeaves(leaves: ProjectFeature[]): ClusterInfo {
  let totalScreens = 0;
  let totalHouseholds = 0;
  let totalImpressions = 0;
  let totalAdBudget = 0;
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

// A stable identity for a project independent of its position in whatever
// list produced it — mediaSiteId when present (it almost always is), a
// coordinate fallback otherwise. Used to look up "the marker for this
// project" from a screen click, and to tell whether a screen belongs to
// the currently-selected project.
function projectKey(feature: ProjectFeature): string {
  return feature.properties.mediaSiteId ?? `${feature.geometry.coordinates[0]},${feature.geometry.coordinates[1]}`;
}

// Cluster marker color/size steps — same tiers as the MapLibre build.
function clusterPinStyle(pointCount: number): { background: string; scale: number } {
  if (pointCount >= 100) return { background: "#312e81", scale: 1.5 };
  if (pointCount >= 25) return { background: "#4338ca", scale: 1.3 };
  return { background: "#6366f1", scale: 1.1 };
}

// Small always-on text tag drawn on every one of our own cluster/project
// markers, distinct from Google's own POI/building labels — makes it
// obvious at a glance which pin is Adonmo's own inventory data vs. the
// dense clutter of restaurant/shop/POI names the basemap already shows.
// Marker3DElement.label defaults to collisionBehavior REQUIRED, i.e.
// always rendered even when it visually collides with basemap labels —
// exactly what "recognizable at a glance" needs.
const ADONMO_LABEL = "ADONMO";

const PROJECT_COLOR = "#f97316";
const PROJECT_SELECTED_COLOR = "#0ea5e9";
const PROJECT_BASE_SCALE = 1;
const PROJECT_SELECTED_BASE_SCALE = 1.3;
const SCREEN_COLOR = "#22d3ee";
const SCREEN_SELECTED_COLOR = "#0891b2";
const SCREEN_SCALE = 0.55;
const SCREEN_SELECTED_SCALE = 0.85;

// Continuous "breathing" pulse on every project pin — a static orange dot
// reads as just one more icon in Google's already-dense POI/building
// clutter (restaurants, shops, ATMs...); motion is what actually separates
// "our data" from "the basemap's data" at a glance, which is the specific
// complaint driving this. Kept to project pins only, not clusters/screens,
// per the request's exact scope. A single shared rAF loop (below) drives
// every currently-rendered project pin's `scale` off one sine wave rather
// than one interval per marker — cheap regardless of how many are on
// screen, and naturally in sync across all of them.
const PULSE_PERIOD_MS = 1400;
const PULSE_AMPLITUDE = 0.16;
const PULSE_SELECTED_AMPLITUDE = 0.24;
// Caps pulse updates to ~30fps: a slow breathing motion doesn't need
// display-refresh-rate fidelity, and it's gentler on Marker3DElement's
// underlying WebGL-backed custom-element rendering than writing `scale`
// every single frame on a 90/120/144Hz display.
const PULSE_MIN_FRAME_MS = 33;

type SelectedCluster = { info: ClusterInfo; leaves: ProjectFeature[] };
type SelectedProject = { feature: ProjectFeature; screens: SyntheticScreen[]; hiddenScreenCount: number };
type MarkerPin = { marker: google.maps.maps3d.Marker3DInteractiveElement; pin: google.maps.marker.PinElement };
// `baseScale` is the pin's resting size (bigger once selected) — the pulse
// loop reads/writes `pin.scale` continuously, so selection state has to
// live in a mutable field the loop can see rather than being written to
// `pin.scale` directly, or the two would fight every frame.
type ProjectMarkerEntry = MarkerPin & { feature: ProjectFeature; baseScale: number };

export default function GoogleInventoryMap({ cityId }: { cityId: CityId }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const pinLibRef = useRef<google.maps.MarkerLibrary | null>(null);
  const maps3dLibRef = useRef<google.maps.Maps3DLibrary | null>(null);

  // Every marker currently on the map — clusters, projects, and screens
  // alike — so a fresh renderLevel() call can tear the whole set down
  // before drawing the next one.
  const levelMarkersRef = useRef<google.maps.maps3d.Marker3DInteractiveElement[]>([]);
  // Projects currently rendered, keyed by projectKey() — lets a screen
  // click find and highlight its owning project's own marker even if that
  // project wasn't individually clicked first.
  const projectMarkersRef = useRef<globalThis.Map<string, ProjectMarkerEntry>>(new globalThis.Map());
  // Screens currently rendered, keyed by screen id.
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

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  // ---- one-time map + library bootstrap ------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [maps3d, markerLib] = await Promise.all([loadMaps3d(), google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>]);
        if (cancelled || !containerRef.current) return;
        maps3dLibRef.current = maps3d;
        pinLibRef.current = markerLib;

        const map = new maps3d.Map3DElement({
          mode: "ROADMAP" as google.maps.maps3d.MapModeString,
          center: { lat: CITIES[0].center[1], lng: CITIES[0].center[0], altitude: 0 },
          range: CITY_MAX_RANGE,
          tilt: CITY_TILT,
          heading: CITY_HEADING,
        });
        map.addEventListener("gmp-click", () => {
          // Background/POI click — mirrors the old "empty space drops the
          // screen selection" behavior instead of yanking the camera.
          setSelectedScreen((current) => (current ? null : current));
          setViewLevel((level) => (level === "screen" ? "project" : level));
        });
        containerRef.current.appendChild(map);
        mapElRef.current = map;
        setMapReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- project pin pulse animation -------------------------------------------
  // One persistent loop for the component's lifetime — it just reads
  // whatever's currently in projectMarkersRef each tick, so it naturally
  // keeps animating whichever project pins exist as clusters expand/collapse
  // and cities switch, with nothing to restart.
  useEffect(() => {
    let lastFrameTime = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastFrameTime >= PULSE_MIN_FRAME_MS) {
        lastFrameTime = timestamp;
        const phase = ((timestamp % PULSE_PERIOD_MS) / PULSE_PERIOD_MS) * Math.PI * 2;
        const wave = Math.sin(phase);
        const selected = selectedProjectMarkerRef.current;
        for (const entry of projectMarkersRef.current.values()) {
          const amplitude = entry === selected ? PULSE_SELECTED_AMPLITUDE : PULSE_AMPLITUDE;
          entry.pin.scale = entry.baseScale * (1 + amplitude * wave);
        }
      }
      pulseRafRef.current = requestAnimationFrame(tick);
    };
    pulseRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current);
    };
  }, []);

  // ---- load city data --------------------------------------------------------
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
      clusterIndexRef.current = buildClusterIndex(fc);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  const clearLevelMarkers = () => {
    for (const m of levelMarkersRef.current) m.remove();
    levelMarkersRef.current = [];
    projectMarkersRef.current.clear();
    screenMarkersRef.current.clear();
    selectedProjectMarkerRef.current = null;
    selectedScreenMarkerRef.current = null;
  };
  const clearScreenSelection = () => {
    if (selectedScreenMarkerRef.current) {
      selectedScreenMarkerRef.current.pin.background = SCREEN_COLOR;
      selectedScreenMarkerRef.current.pin.scale = SCREEN_SCALE;
      selectedScreenMarkerRef.current = null;
    }
  };
  const clearProjectHighlight = () => {
    const sel = selectedProjectMarkerRef.current;
    if (sel) {
      sel.pin.background = PROJECT_COLOR;
      sel.baseScale = PROJECT_BASE_SCALE;
    }
    selectedProjectMarkerRef.current = null;
  };

  const makePin = (opts: { background: string; glyphText?: string; scale?: number }) => {
    const PinElement = pinLibRef.current!.PinElement;
    return new PinElement({
      background: opts.background,
      borderColor: "#ffffff",
      glyphColor: "#ffffff",
      glyphText: opts.glyphText,
      scale: opts.scale ?? 1,
    });
  };

  const flyTo = (opts: { lat: number; lng: number; range: number; tilt: number; heading: number; durationMillis?: number }) => {
    mapElRef.current?.flyCameraTo({
      endCamera: {
        center: { lat: opts.lat, lng: opts.lng, altitude: 0 },
        range: opts.range,
        tilt: opts.tilt,
        heading: opts.heading,
      },
      durationMillis: opts.durationMillis ?? 1400,
    });
  };

  const flyToBbox = (bbox: Bbox, opts: { tilt: number; heading: number; rangeFactor: number; minRange: number; maxRange: number; durationMillis?: number }) => {
    const center = bboxCenter(bbox);
    const range = rangeForBbox(bbox, { factor: opts.rangeFactor, minRange: opts.minRange, maxRange: opts.maxRange });
    flyTo({ lat: center.lat, lng: center.lng, range, tilt: opts.tilt, heading: opts.heading, durationMillis: opts.durationMillis });
  };

  const flyToCity = (fc: ScreenFeatureCollection | null) => {
    const points = (fc?.features ?? []).map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
    const bbox = bboxOfPoints(points);
    if (bbox) {
      flyToBbox(bbox, { tilt: CITY_TILT, heading: CITY_HEADING, rangeFactor: CITY_RANGE_FACTOR, minRange: CITY_MIN_RANGE, maxRange: CITY_MAX_RANGE, durationMillis: 1600 });
    } else {
      const city = CITIES.find((c) => c.id === cityId);
      if (city) flyTo({ lat: city.center[1], lng: city.center[0], range: CITY_MAX_RANGE, tilt: CITY_TILT, heading: CITY_HEADING, durationMillis: 1600 });
    }
  };

  // Selects a project that's already rendered on the map: highlights its
  // marker, updates the panel, flies the camera in. Does NOT create any
  // markers — by the time a project is clickable, its screens already
  // exist (renderProjectWithScreens creates both together).
  const selectProject = (entry: ProjectMarkerEntry) => {
    clearProjectHighlight();
    entry.pin.background = PROJECT_SELECTED_COLOR;
    entry.baseScale = PROJECT_SELECTED_BASE_SCALE;
    selectedProjectMarkerRef.current = entry;

    const { feature } = entry;
    const { screens, hiddenCount } = generateSyntheticScreens(feature);
    setSelectedProject({ feature, screens, hiddenScreenCount: hiddenCount });
    setSelectedScreen(null);
    setViewLevel("project");
    clearScreenSelection();

    const [lng, lat] = feature.geometry.coordinates;
    flyTo({ lat, lng, range: PROJECT_RANGE, tilt: PROJECT_TILT, heading: PROJECT_HEADING, durationMillis: 1300 });
  };

  const selectScreenById = (screenId: string) => {
    const entry = screenMarkersRef.current.get(screenId);
    if (!entry) return;

    // Clicking a screen belonging to a project other than the one currently
    // focused switches project context first, so the panel/highlight stay
    // consistent with whichever screen is actually selected.
    const wantedKey = projectKey(entry.projectFeature);
    const currentKey = selectedProject ? projectKey(selectedProject.feature) : null;
    if (wantedKey !== currentKey) {
      const projEntry = projectMarkersRef.current.get(wantedKey);
      if (projEntry) selectProject(projEntry);
    }

    clearScreenSelection();
    entry.pin.background = SCREEN_SELECTED_COLOR;
    entry.pin.scale = SCREEN_SELECTED_SCALE;
    selectedScreenMarkerRef.current = entry;
    setSelectedScreen(entry.screen);
    setViewLevel("screen");
  };

  // Draws one project marker plus every one of its screens, all at once —
  // this is what makes clicking into a small-enough cluster immediately
  // show real screen-level detail instead of just another marker to click.
  const renderProjectWithScreens = (feature: ProjectFeature) => {
    const map = mapElRef.current;
    const maps3d = maps3dLibRef.current;
    if (!map || !maps3d) return;

    const [lng, lat] = feature.geometry.coordinates;
    const marker = new maps3d.Marker3DInteractiveElement({
      position: { lat, lng, altitude: PROJECT_MARKER_ALTITUDE },
      altitudeMode: MARKER_ALTITUDE_MODE,
      extruded: true,
      drawsWhenOccluded: true,
    });
    const pin = makePin({ background: PROJECT_COLOR });
    marker.appendChild(pin);
    marker.title = feature.properties.name ?? "";
    marker.label = ADONMO_LABEL;
    const entry: ProjectMarkerEntry = { marker, pin, feature, baseScale: PROJECT_BASE_SCALE };
    marker.addEventListener("gmp-click", (e: Event) => {
      e.stopPropagation();
      selectProject(entry);
    });
    map.appendChild(marker);
    levelMarkersRef.current.push(marker);
    projectMarkersRef.current.set(projectKey(feature), entry);

    const { screens } = generateSyntheticScreens(feature);
    for (const s of screens) {
      const sMarker = new maps3d.Marker3DInteractiveElement({
        position: { lat: s.latitude, lng: s.longitude, altitude: SCREEN_MARKER_ALTITUDE },
        altitudeMode: MARKER_ALTITUDE_MODE,
        extruded: true,
        drawsWhenOccluded: true,
      });
      const sPin = makePin({ background: SCREEN_COLOR, scale: SCREEN_SCALE });
      sMarker.appendChild(sPin);
      sMarker.addEventListener("gmp-click", (e: Event) => {
        e.stopPropagation();
        selectScreenById(s.id);
      });
      map.appendChild(sMarker);
      levelMarkersRef.current.push(sMarker);
      screenMarkersRef.current.set(s.id, { marker: sMarker, pin: sPin, projectFeature: feature, screen: s });
    }
  };

  const renderLevel = (items: ReturnType<typeof toClusterOrPoint>[]) => {
    const map = mapElRef.current;
    const maps3d = maps3dLibRef.current;
    if (!map || !maps3d) return;
    clearLevelMarkers();

    for (const item of items) {
      if (item.kind === "cluster") {
        const marker = new maps3d.Marker3DInteractiveElement({
          position: { lat: item.latitude, lng: item.longitude, altitude: CLUSTER_MARKER_ALTITUDE },
          altitudeMode: MARKER_ALTITUDE_MODE,
          extruded: true,
          drawsWhenOccluded: true,
        });
        const style = clusterPinStyle(item.pointCount);
        const pin = makePin({ background: style.background, glyphText: String(item.pointCount), scale: style.scale });
        marker.appendChild(pin);
        marker.label = ADONMO_LABEL;
        marker.addEventListener("gmp-click", (e: Event) => {
          e.stopPropagation();
          handleClusterClick(item.id);
        });
        map.appendChild(marker);
        levelMarkersRef.current.push(marker);
      } else {
        renderProjectWithScreens(item.feature);
      }
    }
  };

  const handleClusterClick = (clusterId: number) => {
    const index = clusterIndexRef.current;
    if (!index) return;
    const leaves = getLeavesAsFeatures(index, clusterId);
    const info = summarizeClusterLeaves(leaves);
    setSelectedCluster({ info, leaves });
    setSelectedProject(null);
    setSelectedScreen(null);
    setViewLevel("cluster");

    const bbox = bboxOfPoints(leaves.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
    if (bbox) {
      flyToBbox(bbox, { tilt: CLUSTER_TILT, heading: CLUSTER_HEADING, rangeFactor: CLUSTER_RANGE_FACTOR, minRange: CLUSTER_MIN_RANGE, maxRange: CLUSTER_MAX_RANGE });
    }

    if (leaves.length <= EXPAND_LEAVES_THRESHOLD) {
      // Small enough — skip supercluster's nested sub-clusters entirely and
      // go straight to every individual project + its screens.
      renderLevel(
        leaves.map((f) => ({
          kind: "point" as const,
          longitude: f.geometry.coordinates[0],
          latitude: f.geometry.coordinates[1],
          feature: f,
        })),
      );
    } else {
      renderLevel(index.getChildren(clusterId).map(toClusterOrPoint));
    }
  };

  // Once both the map and the city's cluster index are ready, draw the
  // top-level clusters/projects and frame the whole city.
  useEffect(() => {
    if (!mapReady || !data || !clusterIndexRef.current) return;
    const items = clusterIndexRef.current.getClusters(WORLD_BBOX, CITY_BIN_ZOOM).map(toClusterOrPoint);
    renderLevel(items);
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

  const inspectorContent =
    viewLevel === "screen" && selectedScreen && projectPanelInfo
      ? ({ kind: "screen", screen: selectedScreen, project: projectPanelInfo } as const)
      : viewLevel === "project" && projectPanelInfo
        ? ({ kind: "project", project: projectPanelInfo } as const)
        : viewLevel === "cluster" && selectedCluster
          ? ({ kind: "cluster", cluster: selectedCluster.info } as const)
          : null;

  const goTo = (level: ViewLevel) => {
    if (level === "city") {
      setSelectedProject(null);
      setSelectedScreen(null);
      setSelectedCluster(null);
      setViewLevel("city");
      if (clusterIndexRef.current) {
        renderLevel(clusterIndexRef.current.getClusters(WORLD_BBOX, CITY_BIN_ZOOM).map(toClusterOrPoint));
      }
      flyToCity(data);
      return;
    }
    if (level === "cluster") {
      // The cluster's own projects/screens are already on the map (they
      // were drawn when the cluster was entered, and selecting a project
      // never removes them) — this just clears the project/screen focus
      // and flies back out, no need to redraw anything.
      clearProjectHighlight();
      clearScreenSelection();
      setSelectedProject(null);
      setSelectedScreen(null);
      setViewLevel("cluster");
      if (selectedCluster) {
        const bbox = bboxOfPoints(selectedCluster.leaves.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
        if (bbox) flyToBbox(bbox, { tilt: CLUSTER_TILT, heading: CLUSTER_HEADING, rangeFactor: CLUSTER_RANGE_FACTOR, minRange: CLUSTER_MIN_RANGE, maxRange: CLUSTER_MAX_RANGE, durationMillis: 1300 });
      }
      return;
    }
    // "project"
    setSelectedScreen(null);
    setViewLevel("project");
    clearScreenSelection();
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {loading && <div className="inventory-status">Loading inventory…</div>}
      {error && <div className="inventory-error">Map error: {error}</div>}
      <div className="inventory-caption">
        3D buildings and imagery are Google Maps Platform's own rendering (alpha channel — for development, not production
        use yet). Orange/blue/cyan markers are Adonmo's own inventory data.
      </div>

      <InspectorPanel
        content={inspectorContent}
        crumbs={crumbs}
        selectedScreenId={selectedScreen?.id ?? null}
        onNavigate={goTo}
        onClose={() => goTo("city")}
        onSelectScreen={(screenId) => selectScreenById(screenId)}
      />
    </div>
  );
}
