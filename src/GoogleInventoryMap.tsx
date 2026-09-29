import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CITIES, loadCityScreens, type CityId, type ScreenFeatureCollection } from "./data/cities";
import InspectorPanel, { type ClusterInfo, type ProjectPanelInfo, type ViewLevel } from "./InspectorPanel";
import CampaignBanner, { type CampaignSummary } from "./CampaignBanner";
import MapLegend from "./MapLegend";
import { generateSyntheticScreens, type SyntheticScreen } from "./syntheticScreens";
import { loadMaps3d } from "./google/loadGoogleMaps";
import {
  buildClusterIndex,
  getLeavesAsFeatures,
  toClusterOrPoint,
  WORLD_BBOX,
  type ProjectFeature,
} from "./google/clustering";
import { bboxCenter, bboxOfPoints, circlePathAround, rangeForBbox, type Bbox } from "./google/cameraMath";
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
// A top-level cluster can be a handful of nearby buildings OR (as with a
// city-wide campaign) hundreds of sites spread across several localities
// many km apart. 3000 used to hard-cap the camera range regardless, which
// for a wide cluster meant the true required range (rangeForBbox's own
// diagonal*factor math) got clamped down far below what the bbox actually
// needed — the camera then centered on the bbox's geometric midpoint at
// way too close a range to show it, frequently landing on empty ground
// between the real clusters/properties instead of pulling back far enough
// to actually frame them. Raised so genuinely spread-out clusters get the
// range their own bbox math asks for; tight local clusters are unaffected
// since rangeForBbox only ever grows toward this ceiling, never away from
// CLUSTER_MIN_RANGE for a small bbox.
const CLUSTER_MAX_RANGE = 20000;

const PROJECT_TILT = 62;
const PROJECT_HEADING = 30;
const PROJECT_RANGE = 380; // pulled back from 220 — that was close enough to feel jammed right up against the building, no surrounding context.

// How long the guided tour dwells on each property before advancing — long
// enough to read the stats panel after the ~1.3s camera fly-in settles,
// short enough that a full 10-property shortlist doesn't feel like a wait.
const TOUR_DWELL_MS = 4800;

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
    visualLink: p.visualLink,
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

// Cluster marker color/size steps — light gray throughout (deliberately
// muted, see CAMPAIGN_DIM_COLOR below), graduated only so a glance still
// tells a 126-site cluster from a 5-site one before reading the number.
function clusterPinStyle(pointCount: number): { background: string; scale: number } {
  if (pointCount >= 100) return { background: "#6b7280", scale: 1.5 };
  if (pointCount >= 25) return { background: "#9ca3af", scale: 1.3 };
  return { background: "#d1d5db", scale: 1.1 };
}

const PROJECT_COLOR = "#111827";
const PROJECT_SELECTED_COLOR = "#0ea5e9";
const PROJECT_BASE_SCALE = 1;
const PROJECT_SELECTED_BASE_SCALE = 1.3;
const SCREEN_COLOR = "#22d3ee";
const SCREEN_SELECTED_COLOR = "#0891b2";
const SCREEN_SCALE = 0.55;
const SCREEN_SELECTED_SCALE = 0.85;

// Campaign-highlight styling: once a campaign context is active (a sales
// upload's shortlist is loaded), every project pin either belongs to the
// campaign — blue, pulses harder, drawn noticeably bigger — or doesn't —
// a light, muted gray, smaller, no pulse. The client's own shortlist is
// what should visually dominate the map; the rest of Adonmo's inventory
// is there for context, not to compete with it, so it deliberately
// recedes instead of outweighing it. A distinct blue from
// PROJECT_SELECTED_COLOR's sky-blue (below) so "in the shortlist" and
// "currently open" (the pin you've clicked) don't read as the same thing.
const CAMPAIGN_HIGHLIGHT_COLOR = "#2563eb";
const CAMPAIGN_HIGHLIGHT_BASE_SCALE = 1.5;
const CAMPAIGN_DIM_COLOR = "#9ca3af";
const CAMPAIGN_DIM_BASE_SCALE = 0.8;

// Google's 3D map tiles are baked into their own basemap and aren't exposed
// as an editable/selectable layer through any public API — there's no way
// to recolor one specific building. Two overlay attempts already failed
// (a flat disc read as a hovering coin; a wide extruded cylinder read as a
// hollow cage with visible seams) because both tried to impersonate the
// building's own shape/volume. These two new attempts deliberately don't:
// they read as a marker calling out a location, not a fake building.
//
// "ring": a thin pulsing halo flat on the ground, breathing in sync with
// the pin above it — a "radar ping" affordance, honest about being UI, not
// a repaint of the building.
// "beacon": a narrow, tall glowing column — a spotlight beam marking the
// spot from above, not a wide shape trying to wrap the building. Narrow
// enough (small radius) that the same "visible segment seam" problem the
// wide cylinder had should be far less noticeable.
//
// Swap this to compare the two live; nothing else needs to change.
const HIGHLIGHT_OVERLAY_STYLE: "ring" | "beacon" | "none" = "ring";

const HIGHLIGHT_RING_RADIUS_METERS = 16;
const HIGHLIGHT_RING_ALTITUDE_METERS = 2; // just off the ground — RELATIVE_TO_GROUND, not CLAMP_TO_GROUND, for the same reliability reasons markers use it.
const HIGHLIGHT_RING_STROKE_MIN = 2;
const HIGHLIGHT_RING_STROKE_MAX = 6;

const HIGHLIGHT_BEACON_RADIUS_METERS = 3.5;
const HIGHLIGHT_BEACON_HEIGHT_METERS = 70; // clears a low/mid-rise building with room to read as a beam above the roofline.
const HIGHLIGHT_BEACON_FILL = "rgba(37, 99, 235, 0.35)";

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
const PULSE_HIGHLIGHT_AMPLITUDE = 0.3;
const PULSE_DIM_AMPLITUDE = 0; // non-campaign pins hold still so the highlighted ones read as "the moving ones".
// Caps pulse updates to ~30fps: a slow breathing motion doesn't need
// display-refresh-rate fidelity, and it's gentler on Marker3DElement's
// underlying WebGL-backed custom-element rendering than writing `scale`
// every single frame on a 90/120/144Hz display.
const PULSE_MIN_FRAME_MS = 33;

type SelectedCluster = { info: ClusterInfo; leaves: ProjectFeature[] };
type SelectedProject = { feature: ProjectFeature; screens: SyntheticScreen[]; hiddenScreenCount: number };
type MarkerPin = { marker: google.maps.maps3d.Marker3DInteractiveElement; pin: google.maps.marker.PinElement };
// `baseScale`/`restColor`/`pulseAmplitude` are the pin's resting state when
// nothing has it selected — the pulse loop reads/writes `pin.scale`
// continuously, so both selection state and campaign-highlight state have
// to live in mutable fields the loop (and clearProjectHighlight) can see,
// rather than being written to `pin.scale`/`pin.background` directly, or
// they'd fight every frame / get clobbered on deselect.
type ProjectMarkerEntry = MarkerPin & {
  feature: ProjectFeature;
  baseScale: number;
  restColor: string;
  restScale: number;
  pulseAmplitude: number;
};

export default function GoogleInventoryMap({
  cityId,
  highlightedMediaSiteIds,
  campaignLabel,
  highlightLabel,
  bannerPortalTarget,
}: {
  cityId: CityId;
  highlightedMediaSiteIds?: Set<string>;
  campaignLabel?: string;
  // Short brand tag (e.g. "LICIOUS") drawn on properties/clusters that
  // belong to the active campaign — every other marker stays unlabeled.
  highlightLabel?: string;
  // The dashboard's embedded view provides a DOM node (a slot in its own
  // header, above this map's container) to portal the CampaignBanner into
  // instead of floating it over the map — see CampaignBanner's own
  // `inline` mode. Undefined/null on the full-screen client-facing link,
  // which keeps the floating banner exactly as before.
  bannerPortalTarget?: HTMLElement | null;
}) {
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
  // Highlight-overlay shapes (see HIGHLIGHT_OVERLAY_STYLE) for every
  // currently-rendered campaign-shortlisted property — separate from
  // levelMarkersRef (typed to interactive markers only) but torn down on
  // the same lifecycle, and pulsed by the same rAF loop as the pins.
  const highlightOverlaysRef = useRef<google.maps.maps3d.Polygon3DElement[]>([]);

  const clusterIndexRef = useRef<ReturnType<typeof buildClusterIndex> | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScreenFeatureCollection | null>(null);

  const [viewLevel, setViewLevel] = useState<ViewLevel>("city");
  const [selectedCluster, setSelectedCluster] = useState<SelectedCluster | null>(null);
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedScreen, setSelectedScreen] = useState<SyntheticScreen | null>(null);
  // Whether Adonmo's own (non-shortlisted) inventory clusters are shown at
  // all — a client toggle via the legend, so they can go look at what
  // else is available beyond what was shortlisted for them, or hide it
  // again to focus on just their own properties. Defaults on (today's
  // behavior); toggling it off only affects the rest of the inventory —
  // the client's own shortlisted properties always stay visible either way.
  const [showInventory, setShowInventory] = useState(true);

  // Guided tour: auto-advances through a campaign's own shortlisted
  // properties, one per dwell period — see startTour/stopTour below.
  const [touring, setTouring] = useState(false);
  const [tourProgress, setTourProgress] = useState<{ current: number; total: number } | null>(null);
  // Where a stopped tour would pick back up — set whenever the tour is
  // interrupted (stop button or any other navigation) mid-run, cleared once
  // it's resumed or once a tour runs all the way to its natural end (at
  // that point there's nothing left to resume, only to restart). Drives
  // the Restart/Resume button pair in CampaignBanner.
  const [tourPause, setTourPause] = useState<{ index: number; total: number } | null>(null);
  const tourTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set only while the tour loop itself is calling selectProject, so
  // selectProject can tell "the tour advanced" apart from "the client
  // clicked something" — a manual click should cancel the tour, the tour's
  // own step should obviously not cancel itself.
  const tourAdvancingRef = useRef(false);

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  // Interrupting a running tour (city switch, unmount) just needs its
  // pending timeout cleared — letting a stale callback fire later would
  // operate on markers that may no longer exist. A city switch also means
  // a different property list entirely, so there's no meaningful "resume"
  // across it either.
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

  // ---- one-time map + library bootstrap ------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [maps3d, markerLib] = await Promise.all([loadMaps3d(), google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>]);
        if (cancelled || !containerRef.current) return;
        maps3dLibRef.current = maps3d;
        pinLibRef.current = markerLib;

        // VITE_GOOGLE_MAPS_MAP_ID (see .env.example) is meant to attach a
        // cloud-configured style that hides Google's own POI/transit icons
        // — currently NOT applied here. Every attempt so far (the style
        // itself, publishing it, switching to HYBRID mode) has broken 3D
        // building rendering instead of fixing it, so this is reverted to
        // the known-good baseline. Do not re-enable mapId/mode switching
        // without confirming in the Cloud Console's own preview — tilted,
        // not top-down — that buildings survive first.
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
          stopTour();
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
          const amplitude = entry === selected ? PULSE_SELECTED_AMPLITUDE : entry.pulseAmplitude;
          entry.pin.scale = entry.baseScale * (1 + amplitude * wave);
        }
        if (HIGHLIGHT_OVERLAY_STYLE === "ring") {
          // "Radar ping" breathing — stroke width oscillates in sync with
          // the pin above it, the same wave driving everything else here.
          const strokeWidth = HIGHLIGHT_RING_STROKE_MIN + ((HIGHLIGHT_RING_STROKE_MAX - HIGHLIGHT_RING_STROKE_MIN) * (wave + 1)) / 2;
          for (const overlay of highlightOverlaysRef.current) {
            overlay.strokeWidth = strokeWidth;
          }
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
      // A campaign's own shortlisted properties are always drawn as
      // individual pins (see highlightedProjectItems below) — excluding
      // them from the cluster index itself, not just special-casing them
      // after the fact, is what guarantees a shortlisted property can
      // never end up bundled inside a cluster pin the client has to click
      // through several levels of unrelated inventory to find. The rest
      // of the city's ordinary inventory still clusters normally — there
      // are 1,000+ of those per city, and showing all of them unclustered
      // would be its own kind of unreadable.
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
    // highlightedMediaSiteIds is derived from campaign selections that
    // don't change while this component stays mounted — reading it via
    // closure here is safe without retriggering this effect on every
    // render (it's a fresh Set instance each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  const clearLevelMarkers = () => {
    for (const m of levelMarkersRef.current) m.remove();
    levelMarkersRef.current = [];
    for (const o of highlightOverlaysRef.current) o.remove();
    highlightOverlaysRef.current = [];
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
      sel.pin.background = sel.restColor;
      sel.baseScale = sel.restScale;
    }
    selectedProjectMarkerRef.current = null;
  };

  const makePin = (opts: { background: string; glyphText?: string; glyphColor?: string; scale?: number; borderColor?: string }) => {
    const PinElement = pinLibRef.current!.PinElement;
    return new PinElement({
      background: opts.background,
      borderColor: opts.borderColor ?? "#ffffff",
      glyphColor: opts.glyphColor ?? "#ffffff",
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
    // A campaign view opens framed on exactly the client's own shortlisted
    // properties, not the whole city — those are what's actually relevant,
    // and they're already drawn as individual pins from the first frame
    // (see highlightedProjectItems), so there's no reason to open on a
    // wide city shot the client then has to hunt across for their own
    // markers. Falls back to the whole city otherwise (or when a campaign
    // happens to have nothing in this particular city).
    const highlighted =
      highlightedMediaSiteIds && highlightedMediaSiteIds.size > 0
        ? (fc?.features ?? []).filter((f) => f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId))
        : [];
    const relevant = highlighted.length > 0 ? highlighted : (fc?.features ?? []);
    const points = relevant.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
    const bbox = bboxOfPoints(points);
    if (bbox) {
      const framing = highlighted.length > 0
        ? { tilt: CLUSTER_TILT, heading: CLUSTER_HEADING, rangeFactor: CLUSTER_RANGE_FACTOR, minRange: CLUSTER_MIN_RANGE, maxRange: CLUSTER_MAX_RANGE }
        : { tilt: CITY_TILT, heading: CITY_HEADING, rangeFactor: CITY_RANGE_FACTOR, minRange: CITY_MIN_RANGE, maxRange: CITY_MAX_RANGE };
      flyToBbox(bbox, { ...framing, durationMillis: 1600 });
    } else {
      const city = CITIES.find((c) => c.id === cityId);
      if (city) flyTo({ lat: city.center[1], lng: city.center[0], range: CITY_MAX_RANGE, tilt: CITY_TILT, heading: CITY_HEADING, durationMillis: 1600 });
    }
  };

  const clearTourTimer = () => {
    if (tourTimeoutRef.current != null) {
      clearTimeout(tourTimeoutRef.current);
      tourTimeoutRef.current = null;
    }
  };

  // Ends the tour with nothing left to resume — either it ran all the way
  // to its last property, or its underlying markers went stale (e.g. a
  // city switch raced the pending timeout). Distinct from stopTour, which
  // is an interruption the client can pick back up from.
  const endTour = () => {
    clearTourTimer();
    setTouring(false);
    setTourProgress(null);
    setTourPause(null);
  };

  // User-facing pause: the Stop button, or any other navigation
  // interrupting a running tour. Remembers exactly which property it was
  // on so Resume can pick back up there instead of restarting from the top.
  const stopTour = () => {
    clearTourTimer();
    if (touring && tourProgress) {
      setTourPause({ index: tourProgress.current - 1, total: tourProgress.total });
    }
    setTouring(false);
    setTourProgress(null);
  };

  // Walks the campaign's own shortlisted properties one at a time starting
  // at fromIndex (0 for a fresh start, tourPause.index to resume) — each
  // step reuses selectProject exactly as a manual click would (same
  // camera fly-in, same panel), just paced automatically instead of
  // waiting for a click. A sales rep can start this and talk through the
  // portfolio live on a call without touching the map again.
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
        // The map's moved out from under the tour (e.g. a city switch
        // raced this timeout) — bail rather than operate on stale state.
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

  // Selects a project that's already rendered on the map: highlights its
  // marker, updates the panel, flies the camera in. Does NOT create any
  // markers — by the time a project is clickable, its screens already
  // exist (renderProjectWithScreens creates both together).
  const selectProject = (entry: ProjectMarkerEntry) => {
    // A manual selection (this is also the click handler's own call path)
    // cancels a running tour — the tour's own step sets tourAdvancingRef
    // first so its calls don't cancel themselves.
    if (!tourAdvancingRef.current) stopTour();
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
    stopTour();

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

    let restColor: string = PROJECT_COLOR;
    let restScale = PROJECT_BASE_SCALE;
    let pulseAmplitude = PULSE_AMPLITUDE;
    let isHighlighted = false;
    if (highlightedMediaSiteIds) {
      isHighlighted = feature.properties.mediaSiteId != null && highlightedMediaSiteIds.has(feature.properties.mediaSiteId);
      restColor = isHighlighted ? CAMPAIGN_HIGHLIGHT_COLOR : CAMPAIGN_DIM_COLOR;
      restScale = isHighlighted ? CAMPAIGN_HIGHLIGHT_BASE_SCALE : CAMPAIGN_DIM_BASE_SCALE;
      pulseAmplitude = isHighlighted ? PULSE_HIGHLIGHT_AMPLITUDE : PULSE_DIM_AMPLITUDE;
    }

    const pin = makePin({ background: restColor, scale: restScale });
    marker.appendChild(pin);
    // Native hover tooltip only — no persistent on-map text label. Several
    // shortlisted properties close together used to each draw their own
    // brand-name label (e.g. repeated "ZOMATO"s) stacked and overlapping
    // into unreadable clutter; the pin's own color/size is what marks it
    // as "yours" now, not a text tag competing for space on the map.
    marker.title = feature.properties.name ?? "";
    const entry: ProjectMarkerEntry = { marker, pin, feature, baseScale: restScale, restColor, restScale, pulseAmplitude };
    marker.addEventListener("gmp-click", (e: Event) => {
      e.stopPropagation();
      selectProject(entry);
    });
    map.appendChild(marker);
    levelMarkersRef.current.push(marker);
    projectMarkersRef.current.set(projectKey(feature), entry);

    if (isHighlighted && HIGHLIGHT_OVERLAY_STYLE !== "none") {
      const overlay =
        HIGHLIGHT_OVERLAY_STYLE === "ring"
          ? new maps3d.Polygon3DElement({
              // Flat, not extruded — a thin breathing halo on the ground,
              // not a shape trying to be the building.
              path: circlePathAround({ lat, lng }, HIGHLIGHT_RING_RADIUS_METERS, HIGHLIGHT_RING_ALTITUDE_METERS),
              altitudeMode: MARKER_ALTITUDE_MODE,
              extruded: false,
              drawsOccludedSegments: true,
              fillColor: "rgba(37, 99, 235, 0.08)",
              strokeColor: CAMPAIGN_HIGHLIGHT_COLOR,
              strokeWidth: HIGHLIGHT_RING_STROKE_MIN,
            })
          : new maps3d.Polygon3DElement({
              // Narrow and tall — a beacon marking the spot from above,
              // not a wide shape trying to wrap the building.
              path: circlePathAround({ lat, lng }, HIGHLIGHT_BEACON_RADIUS_METERS, HIGHLIGHT_BEACON_HEIGHT_METERS),
              altitudeMode: MARKER_ALTITUDE_MODE,
              extruded: true,
              drawsOccludedSegments: true,
              fillColor: HIGHLIGHT_BEACON_FILL,
              strokeColor: CAMPAIGN_HIGHLIGHT_COLOR,
              strokeWidth: 1,
            });
      map.appendChild(overlay);
      highlightOverlaysRef.current.push(overlay);
    }

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

  // Clusters can never contain a campaign-highlighted property — the
  // cluster index itself is built excluding them (see the city-data
  // effect) — so cluster pins always use their plain style now; no
  // per-cluster highlight check needed.
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

  const toPointItem = (f: ProjectFeature) => ({
    kind: "point" as const,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    feature: f,
  });

  // A campaign's own shortlisted properties, as individual point items —
  // drawn on top of whatever the (campaign-free) cluster index produces at
  // every level, city view through cluster drill-down, so they're always
  // visible and directly clickable, never one click away inside a cluster.
  const highlightedProjectItems = () => {
    if (!highlightedMediaSiteIds || highlightedMediaSiteIds.size === 0 || !data) return [];
    return data.features
      .filter((f) => f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId))
      .map(toPointItem);
  };

  // The city-level "rest of inventory" clusters — empty while the client
  // has toggled Adonmo's own inventory off (see toggleInventory), leaving
  // only their own shortlist on the map. `show` defaults to the current
  // showInventory state, but toggleInventory needs to render against the
  // *new* value before that state update has actually landed, hence the
  // override param rather than always reading showInventory directly.
  const cityLevelItems = (show: boolean = showInventory) => {
    if (!show || !clusterIndexRef.current) return [];
    return clusterIndexRef.current.getClusters(WORLD_BBOX, CITY_BIN_ZOOM).map(toClusterOrPoint);
  };

  // Client-facing legend toggle: show/hide the rest of Adonmo's inventory
  // without touching their own shortlisted properties, which stay visible
  // either way. Resets to city level rather than preserving whatever
  // drill-down state existed — a mid-cluster view stops making sense the
  // moment the clusters it was drilled into disappear.
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

  const handleClusterClick = (clusterId: number) => {
    const index = clusterIndexRef.current;
    if (!index) return;
    stopTour();
    // A campaign's properties were already excluded when this index was
    // built, so leaves here are always ordinary (non-highlighted)
    // inventory — no per-click filtering needed to keep them apart.
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

    // Small enough — skip supercluster's nested sub-clusters entirely and
    // go straight to every individual project + its screens. Otherwise
    // drill one level at a time via supercluster's own children. Either
    // way, the campaign's own properties are re-added on top — renderLevel
    // clears everything first, and they need to stay visible/clickable
    // regardless of which part of the rest of the inventory is on screen.
    const rest = leaves.length <= EXPAND_LEAVES_THRESHOLD ? leaves.map(toPointItem) : index.getChildren(clusterId).map(toClusterOrPoint);
    renderLevel([...highlightedProjectItems(), ...rest]);
  };

  // Once both the map and the city's cluster index are ready, draw the
  // top-level clusters/projects (plus the campaign's own properties, always
  // individually) and frame the view.
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

  // Citywide campaign totals — stays constant across drill-down navigation
  // (unlike the breadcrumb-scoped cluster/project stats below) so the
  // headline "what does this campaign cover" number never disappears while
  // exploring.
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
      // The cluster's own projects/screens are already on the map (they
      // were drawn when the cluster was entered, and selecting a project
      // never removes them) — this just clears the project/screen focus
      // and flies back out, no need to redraw anything. selectedCluster's
      // leaves are always ordinary inventory (campaign properties are
      // excluded from the cluster index itself), so no highlight filtering
      // is needed to frame them.
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

      {loading && (
        <div className="inventory-loading">
          <span className="inventory-loading-spinner" />
          Loading inventory…
        </div>
      )}
      {error && <div className="inventory-error">Map error: {error}</div>}

      {bannerPortalTarget ? (
        createPortal(
          <CampaignBanner
            summary={campaignSummary}
            touring={touring}
            tourProgress={tourProgress}
            tourPause={tourPause}
            onStartTour={() => startTour(0)}
            onResumeTour={() => tourPause && startTour(tourPause.index)}
            onStopTour={stopTour}
            inline
          />,
          bannerPortalTarget
        )
      ) : (
        <CampaignBanner
          summary={campaignSummary}
          touring={touring}
          tourProgress={tourProgress}
          tourPause={tourPause}
          onStartTour={() => startTour(0)}
          onResumeTour={() => tourPause && startTour(tourPause.index)}
          onStopTour={stopTour}
        />
      )}
      <MapLegend highlightLabel={highlightLabel} showInventory={showInventory} onToggleInventory={toggleInventory} />

      <InspectorPanel content={inspectorContent} crumbs={crumbs} onNavigate={goTo} onClose={() => goTo("city")} />
    </div>
  );
}
