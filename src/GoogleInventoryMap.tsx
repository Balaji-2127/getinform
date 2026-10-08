import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CITIES, loadCityScreens, type CityId, type ScreenFeatureCollection } from "./data/cities";
import InspectorPanel, { type ClusterInfo, type ProjectPanelInfo, type ViewLevel } from "./InspectorPanel";
import CampaignBanner, { type CampaignSummary } from "./CampaignBanner";
import MapLegend from "./MapLegend";
import { generateSyntheticScreens, type SyntheticScreen } from "./syntheticScreens";
import { loadMaps3d } from "./google/loadGoogleMaps";
import { type ProjectFeature } from "./google/clustering";
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

// flyToCity's tighter framing for when a campaign's shortlisted properties
// are what's actually being opened on, not the whole city — those tend to
// be a handful of sites rather than spread across it.
const SHORTLIST_FRAME_TILT = 55;
const SHORTLIST_FRAME_HEADING = -25;
const SHORTLIST_FRAME_RANGE_FACTOR = 1.0;
const SHORTLIST_FRAME_MIN_RANGE = 350;
// A shortlist can be a handful of nearby buildings OR (a city-wide
// campaign) hundreds of sites spread across several localities many km
// apart. A low cap here would clamp the camera down far below what the
// bbox actually needs, centering on its geometric midpoint at too close a
// range to show it — frequently landing on empty ground between the real
// properties instead of pulling back far enough to frame them. Raised so
// genuinely spread-out shortlists get the range their own bbox math asks
// for; tight local ones are unaffected, since rangeForBbox only ever grows
// toward this ceiling, never away from SHORTLIST_FRAME_MIN_RANGE for a
// small bbox.
const SHORTLIST_FRAME_MAX_RANGE = 20000;

const PROJECT_TILT = 62;
const PROJECT_HEADING = 30;
const PROJECT_RANGE = 380; // pulled back from 220 — that was close enough to feel jammed right up against the building, no surrounding context.

// How long the guided tour dwells on each property before advancing — long
// enough to read the stats panel after the ~1.3s camera fly-in settles,
// short enough that a full 10-property shortlist doesn't feel like a wait.
const TOUR_DWELL_MS = 4800;

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
const PROJECT_MARKER_ALTITUDE = 45; // above typical Hyderabad low/mid-rise residential buildings.

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

const PROJECT_COLOR = "#111827";
const PROJECT_SELECTED_COLOR = "#0ea5e9";
const PROJECT_BASE_SCALE = 1;
const PROJECT_SELECTED_BASE_SCALE = 1.3;

// Campaign-highlight styling: once a campaign context is active (a sales
// upload's shortlist is loaded), every project pin either belongs to the
// campaign — blue, pulses harder, drawn noticeably bigger — or doesn't —
// smaller, no pulse, and (see CAMPAIGN_DIM_COLOR) a deliberately quieter
// color. The client's own shortlist is what should visually dominate the
// map; the rest of Adonmo's inventory is there for context, not to
// compete with it, so it deliberately recedes instead of outweighing it.
// See CAMPAIGN_HIGHLIGHT_SELECTED_COLOR below for why selecting a pin
// doesn't just snap it to one shared "selected" blue regardless of which
// group it started in.
const CAMPAIGN_HIGHLIGHT_COLOR = "#2563eb";
const CAMPAIGN_HIGHLIGHT_BASE_SCALE = 1.5;
// Went gray (#9ca3af) -> darker gray (#71717a) -> orange (#f97316) ->
// bright green (#4ade80), settling on a light, muted army/olive green:
// still clearly its own hue (nowhere near CAMPAIGN_HIGHLIGHT_COLOR's
// blue below), softer and less saturated than the bright green attempt.
const CAMPAIGN_DIM_COLOR = "#9aab7a";
const CAMPAIGN_DIM_BASE_SCALE = 0.8;
// Selecting a property used to always snap its pin to one universal
// "selected" sky blue (PROJECT_SELECTED_COLOR) — which, for a dim/green
// (ordinary inventory, not targeted) property, looked exactly like the
// "this is yours" campaign-highlight blue once clicked. A client clicking
// around Adonmo's general inventory would see it turn blue and reasonably
// think it had just become part of their shortlist. Selected state now
// stays within whichever color family the pin already belonged to —
// blue gets a deeper blue, green gets a deeper green — so blue always
// and only means "targeted for you", full stop, selected or not.
const CAMPAIGN_HIGHLIGHT_SELECTED_COLOR = "#1e3a8a";
const CAMPAIGN_DIM_SELECTED_COLOR = "#6b7a4f";

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

// One property to draw a pin for. Only the property itself is drawn on the
// map — its screens are listed in the side panel, not as map markers.
type RenderItem = { longitude: number; latitude: number; feature: ProjectFeature };
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
  // Whether this property belongs to the active campaign's shortlist —
  // decides which color family selecting it should use (see
  // CAMPAIGN_HIGHLIGHT_SELECTED_COLOR / CAMPAIGN_DIM_SELECTED_COLOR).
  isHighlighted: boolean;
};

export default function GoogleInventoryMap({
  cityId,
  highlightedMediaSiteIds,
  campaignLabel,
  highlightLabel,
  clientName,
  bannerPortalTarget,
}: {
  cityId: CityId;
  highlightedMediaSiteIds?: Set<string>;
  campaignLabel?: string;
  // Short brand tag (e.g. "LICIOUS") drawn on properties/clusters that
  // belong to the active campaign — every other marker stays unlabeled.
  highlightLabel?: string;
  // The client's real (properly-cased) name — passed straight through to
  // CampaignBanner, which only actually shows it in the floating variant.
  // See CampaignBanner's own clientName for why.
  clientName?: string;
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

  // Every marker currently on the map — projects and screens alike — so a
  // fresh renderLevel() call can tear the whole set down
  // before drawing the next one.
  const levelMarkersRef = useRef<google.maps.maps3d.Marker3DInteractiveElement[]>([]);
  // Projects currently rendered, keyed by projectKey() — lets the tour find
  // each shortlisted property's own marker.
  const projectMarkersRef = useRef<globalThis.Map<string, ProjectMarkerEntry>>(new globalThis.Map());
  const selectedProjectMarkerRef = useRef<ProjectMarkerEntry | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  // Highlight-overlay shapes (see HIGHLIGHT_OVERLAY_STYLE) for every
  // currently-rendered campaign-shortlisted property — separate from
  // levelMarkersRef (typed to interactive markers only) but torn down on
  // the same lifecycle, and pulsed by the same rAF loop as the pins.
  const highlightOverlaysRef = useRef<google.maps.maps3d.Polygon3DElement[]>([]);

  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScreenFeatureCollection | null>(null);

  const [viewLevel, setViewLevel] = useState<ViewLevel>("city");
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedScreen, setSelectedScreen] = useState<SyntheticScreen | null>(null);
  // Whether Adonmo's own (non-shortlisted) inventory pins are shown at
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
  // keeps animating whichever project pins exist as selections change and
  // cities switch, with nothing to restart.
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
          // Dim (non-highlighted) pins hold still — amplitude 0 — and with
          // every property on the map now its own pin rather than a
          // handful of cluster bubbles, that's the overwhelming majority
          // of entries here; skipping the no-op write keeps this loop
          // cheap regardless of how many thousand are on screen.
          if (amplitude !== 0) entry.pin.scale = entry.baseScale * (1 + amplitude * wave);
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
    setSelectedProject(null);
    setSelectedScreen(null);
    loadCityScreens(cityId).then((fc) => {
      if (cancelled) return;
      setData(fc);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  const clearLevelMarkers = () => {
    for (const m of levelMarkersRef.current) m.remove();
    levelMarkersRef.current = [];
    for (const o of highlightOverlaysRef.current) o.remove();
    highlightOverlaysRef.current = [];
    projectMarkersRef.current.clear();
    selectedProjectMarkerRef.current = null;
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
        ? { tilt: SHORTLIST_FRAME_TILT, heading: SHORTLIST_FRAME_HEADING, rangeFactor: SHORTLIST_FRAME_RANGE_FACTOR, minRange: SHORTLIST_FRAME_MIN_RANGE, maxRange: SHORTLIST_FRAME_MAX_RANGE }
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
  // marker, updates the panel, flies the camera in. Only the building is
  // shown on the map — its screens are listed in the panel instead.
  const selectProject = (entry: ProjectMarkerEntry) => {
    // A manual selection (this is also the click handler's own call path)
    // cancels a running tour — the tour's own step sets tourAdvancingRef
    // first so its calls don't cancel themselves.
    if (!tourAdvancingRef.current) stopTour();
    clearProjectHighlight();
    entry.pin.background = highlightedMediaSiteIds
      ? entry.isHighlighted
        ? CAMPAIGN_HIGHLIGHT_SELECTED_COLOR
        : CAMPAIGN_DIM_SELECTED_COLOR
      : PROJECT_SELECTED_COLOR;
    entry.baseScale = PROJECT_SELECTED_BASE_SCALE;
    selectedProjectMarkerRef.current = entry;

    const { feature } = entry;
    const { screens, hiddenCount } = generateSyntheticScreens(feature);
    setSelectedProject({ feature, screens, hiddenScreenCount: hiddenCount });
    setSelectedScreen(null);
    setViewLevel("project");

    const [lng, lat] = feature.geometry.coordinates;
    flyTo({ lat, lng, range: PROJECT_RANGE, tilt: PROJECT_TILT, heading: PROJECT_HEADING, durationMillis: 1300 });
  };

  // Draws one project's own pin (plus its campaign-highlight overlay, if
  // any) — never its screens, which the side panel lists instead.
  const renderProjectPin = (feature: ProjectFeature): ProjectMarkerEntry | undefined => {
    const map = mapElRef.current;
    const maps3d = maps3dLibRef.current;
    if (!map || !maps3d) return undefined;

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
    const entry: ProjectMarkerEntry = { marker, pin, feature, baseScale: restScale, restColor, restScale, pulseAmplitude, isHighlighted };
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

    return entry;
  };

  // Every property is drawn as an individual pin, highlighted or not —
  // nothing on this map ever bundles multiple properties behind a single
  // cluster bubble a client would have to click through.
  const renderLevel = (items: RenderItem[]) => {
    const map = mapElRef.current;
    const maps3d = maps3dLibRef.current;
    if (!map || !maps3d) return;
    clearLevelMarkers();

    for (const item of items) renderProjectPin(item.feature);
  };

  const toPointItem = (f: ProjectFeature): RenderItem => ({
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    feature: f,
  });

  // A campaign's own shortlisted properties, as individual point items.
  const highlightedProjectItems = (): RenderItem[] => {
    if (!highlightedMediaSiteIds || highlightedMediaSiteIds.size === 0 || !data) return [];
    return data.features
      .filter((f) => f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId))
      .map((f) => toPointItem(f));
  };

  // The rest of Adonmo's inventory — every other property in the city,
  // each its own pin. Empty while the
  // client has toggled it off via the legend, leaving only their own
  // shortlist on the map. `show` defaults to the current showInventory
  // state, but toggleInventory needs to render against the *new* value
  // before that state update has actually landed, hence the override
  // param rather than always reading showInventory directly.
  const cityLevelItems = (show: boolean = showInventory): RenderItem[] => {
    if (!show || !data) return [];
    return data.features
      .filter((f) => !(highlightedMediaSiteIds && f.properties.mediaSiteId != null && highlightedMediaSiteIds.has(f.properties.mediaSiteId)))
      .map((f) => toPointItem(f));
  };

  // Client-facing legend toggle: show/hide the rest of Adonmo's inventory
  // without touching their own shortlisted properties, which stay visible
  // either way.
  const toggleInventory = () => {
    const next = !showInventory;
    setShowInventory(next);
    stopTour();
    clearProjectHighlight();
    setSelectedProject(null);
    setSelectedScreen(null);
    setViewLevel("city");
    renderLevel([...highlightedProjectItems(), ...cityLevelItems(next)]);
  };

  // Once both the map and the city's data are ready, draw every property
  // (plus the campaign's own properties) and frame the view.
  useEffect(() => {
    if (!mapReady || !data) return;
    renderLevel([...highlightedProjectItems(), ...cityLevelItems()]);
    flyToCity(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data]);

  const projectPanelInfo = selectedProject ? toProjectPanelInfo(selectedProject.feature, selectedProject.screens, selectedProject.hiddenScreenCount) : null;

  const crumbs = useMemo(() => {
    const list: { label: string; level: ViewLevel }[] = [{ label: cityLabel, level: "city" }];
    if (projectPanelInfo) list.push({ label: projectPanelInfo.name, level: "project" });
    if (selectedScreen) list.push({ label: selectedScreen.id, level: "screen" });
    return list;
  }, [cityLabel, projectPanelInfo, selectedScreen]);

  // Citywide campaign totals — stays constant across navigation (unlike
  // the breadcrumb-scoped project stats below) so the headline "what does
  // this campaign cover" number never disappears while exploring.
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
        : null;

  const goTo = (level: ViewLevel) => {
    stopTour();
    if (level === "city") {
      setSelectedProject(null);
      setSelectedScreen(null);
      setViewLevel("city");
      renderLevel([...highlightedProjectItems(), ...cityLevelItems()]);
      flyToCity(data);
      return;
    }
    // "project"
    setSelectedScreen(null);
    setViewLevel("project");
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
          clientName={clientName}
        />
      )}
      <MapLegend highlightLabel={highlightLabel} showInventory={showInventory} onToggleInventory={toggleInventory} />

      <InspectorPanel content={inspectorContent} crumbs={crumbs} onNavigate={goTo} onClose={() => goTo("city")} />
    </div>
  );
}
