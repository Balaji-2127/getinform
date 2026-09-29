import { useEffect, useRef, useState } from "react";
import { CITIES, loadCityScreens, type CityId, type ScreenFeatureCollection } from "../data/cities";
import { loadMaps3d } from "../google/loadGoogleMaps";
import { buildClusterIndex, getLeavesAsFeatures, toClusterOrPoint, WORLD_BBOX, type ProjectFeature } from "../google/clustering";
import { bboxOfPoints, rangeForBbox, type Bbox } from "../google/cameraMath";
import { ExpandIcon, FilterIcon, SearchIcon } from "./icons";
import "./DashboardMap.css";

// A second, simpler map component for the new dashboard shell — not a
// variant of GoogleInventoryMap and doesn't touch it. That component is
// built for a full-screen client-facing campaign view (campaign
// highlighting, guided tour, its own floating InspectorPanel/
// CampaignBanner). This one is a plain inventory browser embedded in a
// bounded panel: no campaign context, no tour, selection is lifted to the
// parent (CampaignsPage) instead of showing its own detail panel, since
// the dashboard has its own purpose-built one matching the reference layout.
const CITY_BIN_ZOOM = 10;
const CITY_TILT = 45;
const CITY_HEADING = 0;
const CITY_RANGE_FACTOR = 0.85;
const CITY_MIN_RANGE = 8000;
const CITY_MAX_RANGE = 70000;

const CLUSTER_TILT = 55;
const CLUSTER_HEADING = -20;
const CLUSTER_RANGE_FACTOR = 1.0;
const CLUSTER_MIN_RANGE = 350;
const CLUSTER_MAX_RANGE = 20000;

const PROJECT_TILT = 58;
const PROJECT_HEADING = 25;
const PROJECT_RANGE = 420;

const EXPAND_LEAVES_THRESHOLD = 60;

const PROJECT_COLOR = "#f97316"; // Adonmo's own inventory, browsed generically — orange, matching the reference mockup's pin color, distinct from the client-facing map's blue/gray scheme (different context, different meaning).
const PROJECT_SELECTED_COLOR = "#2563eb";
const CLUSTER_COLOR = "#4338ca";

function clusterStyle(pointCount: number): { background: string; scale: number } {
  if (pointCount >= 100) return { background: "#312e81", scale: 1.4 };
  if (pointCount >= 25) return { background: CLUSTER_COLOR, scale: 1.2 };
  return { background: "#6366f1", scale: 1.05 };
}

type MarkerEntry = { marker: google.maps.maps3d.Marker3DInteractiveElement; pin: google.maps.marker.PinElement; feature: ProjectFeature };

export default function DashboardMap({
  cityId,
  onCityChange,
  selectedMediaSiteId,
  onSelectProject,
  expanded,
  onToggleExpanded,
}: {
  cityId: CityId;
  onCityChange: (id: CityId) => void;
  selectedMediaSiteId: string | null;
  onSelectProject: (feature: ProjectFeature) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const pinLibRef = useRef<google.maps.MarkerLibrary | null>(null);
  const maps3dLibRef = useRef<google.maps.Maps3DLibrary | null>(null);
  const levelMarkersRef = useRef<google.maps.maps3d.Marker3DInteractiveElement[]>([]);
  const projectMarkersRef = useRef<globalThis.Map<string, MarkerEntry>>(new globalThis.Map());
  const selectedRef = useRef<MarkerEntry | null>(null);
  const clusterIndexRef = useRef<ReturnType<typeof buildClusterIndex> | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"ROADMAP" | "HYBRID">("ROADMAP");

  const cityLabel = CITIES.find((c) => c.id === cityId)?.label ?? cityId;

  // ---- one-time map bootstrap ------------------------------------------
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

  useEffect(() => {
    mapElRef.current?.setAttribute("mode", mode);
  }, [mode]);

  const flyTo = (opts: { lat: number; lng: number; range: number; tilt: number; heading: number; durationMillis?: number }) => {
    mapElRef.current?.flyCameraTo({
      endCamera: { center: { lat: opts.lat, lng: opts.lng, altitude: 0 }, range: opts.range, tilt: opts.tilt, heading: opts.heading },
      durationMillis: opts.durationMillis ?? 1300,
    });
  };
  const flyToBbox = (bbox: Bbox, opts: { tilt: number; heading: number; rangeFactor: number; minRange: number; maxRange: number; durationMillis?: number }) => {
    const [[minLng, minLat], [maxLng, maxLat]] = bbox;
    const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
    const range = rangeForBbox(bbox, { factor: opts.rangeFactor, minRange: opts.minRange, maxRange: opts.maxRange });
    flyTo({ ...center, range, tilt: opts.tilt, heading: opts.heading, durationMillis: opts.durationMillis });
  };

  const makePin = (background: string, glyphText?: string) => {
    const PinElement = pinLibRef.current!.PinElement;
    return new PinElement({ background, borderColor: "#ffffff", glyphColor: "#ffffff", glyphText, scale: glyphText ? 1.1 : 1 });
  };

  const clearMarkers = () => {
    for (const m of levelMarkersRef.current) m.remove();
    levelMarkersRef.current = [];
    projectMarkersRef.current.clear();
    selectedRef.current = null;
  };

  const selectFeature = (entry: MarkerEntry) => {
    if (selectedRef.current) selectedRef.current.pin.background = PROJECT_COLOR;
    entry.pin.background = PROJECT_SELECTED_COLOR;
    selectedRef.current = entry;
    onSelectProject(entry.feature);
    const [lng, lat] = entry.feature.geometry.coordinates;
    flyTo({ lat, lng, range: PROJECT_RANGE, tilt: PROJECT_TILT, heading: PROJECT_HEADING });
  };

  const renderProject = (feature: ProjectFeature) => {
    const map = mapElRef.current;
    const maps3d = maps3dLibRef.current;
    if (!map || !maps3d) return;
    const [lng, lat] = feature.geometry.coordinates;
    const isSelected = feature.properties.mediaSiteId != null && feature.properties.mediaSiteId === selectedMediaSiteId;
    const marker = new maps3d.Marker3DInteractiveElement({
      position: { lat, lng, altitude: 40 },
      altitudeMode: "RELATIVE_TO_GROUND" as google.maps.maps3d.AltitudeModeString,
      extruded: true,
      drawsWhenOccluded: true,
    });
    const pin = makePin(isSelected ? PROJECT_SELECTED_COLOR : PROJECT_COLOR);
    marker.appendChild(pin);
    marker.title = feature.properties.name ?? "";
    const entry: MarkerEntry = { marker, pin, feature };
    marker.addEventListener("gmp-click", (e: Event) => {
      e.stopPropagation();
      selectFeature(entry);
    });
    map.appendChild(marker);
    levelMarkersRef.current.push(marker);
    const key = feature.properties.mediaSiteId ?? `${lng},${lat}`;
    projectMarkersRef.current.set(key, entry);
    if (isSelected) selectedRef.current = entry;
  };

  const renderLevel = (items: ReturnType<typeof toClusterOrPoint>[]) => {
    const map = mapElRef.current;
    const maps3d = maps3dLibRef.current;
    if (!map || !maps3d) return;
    clearMarkers();
    for (const item of items) {
      if (item.kind === "cluster") {
        const style = clusterStyle(item.pointCount);
        const marker = new maps3d.Marker3DInteractiveElement({
          position: { lat: item.latitude, lng: item.longitude, altitude: 90 },
          altitudeMode: "RELATIVE_TO_GROUND" as google.maps.maps3d.AltitudeModeString,
          extruded: true,
          drawsWhenOccluded: true,
        });
        const pin = makePin(style.background, String(item.pointCount));
        pin.scale = style.scale;
        marker.appendChild(pin);
        marker.addEventListener("gmp-click", (e: Event) => {
          e.stopPropagation();
          handleClusterClick(item.id);
        });
        map.appendChild(marker);
        levelMarkersRef.current.push(marker);
      } else {
        renderProject(item.feature);
      }
    }
  };

  const handleClusterClick = (clusterId: number) => {
    const index = clusterIndexRef.current;
    if (!index) return;
    const leaves = getLeavesAsFeatures(index, clusterId);
    const bbox = bboxOfPoints(leaves.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
    if (bbox) flyToBbox(bbox, { tilt: CLUSTER_TILT, heading: CLUSTER_HEADING, rangeFactor: CLUSTER_RANGE_FACTOR, minRange: CLUSTER_MIN_RANGE, maxRange: CLUSTER_MAX_RANGE });
    const items = leaves.length <= EXPAND_LEAVES_THRESHOLD ? leaves.map((f) => toClusterOrPointFromFeature(f)) : index.getChildren(clusterId).map(toClusterOrPoint);
    renderLevel(items);
  };

  function toClusterOrPointFromFeature(f: ProjectFeature): ReturnType<typeof toClusterOrPoint> {
    return { kind: "point", longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1], feature: f };
  }

  // ---- load city data ----------------------------------------------------
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    loadCityScreens(cityId).then((fc: ScreenFeatureCollection) => {
      if (cancelled || !mapElRef.current) return;
      clusterIndexRef.current = buildClusterIndex(fc);
      const items = clusterIndexRef.current.getClusters(WORLD_BBOX, CITY_BIN_ZOOM).map(toClusterOrPoint);
      renderLevel(items);
      const bbox = bboxOfPoints(fc.features.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })));
      if (bbox) flyToBbox(bbox, { tilt: CITY_TILT, heading: CITY_HEADING, rangeFactor: CITY_RANGE_FACTOR, minRange: CITY_MIN_RANGE, maxRange: CITY_MAX_RANGE, durationMillis: 1500 });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, mapReady]);

  return (
    <div className={"dm-panel" + (expanded ? " dm-panel-expanded" : "")}>
      <div className="dm-toolbar">
        <div className="dm-mode-toggle">
          <button type="button" className={mode === "ROADMAP" ? "is-active" : ""} onClick={() => setMode("ROADMAP")}>
            Map
          </button>
          <button type="button" className={mode === "HYBRID" ? "is-active" : ""} onClick={() => setMode("HYBRID")}>
            Satellite
          </button>
          <button type="button" className="is-active" disabled title="This map is always 3D">
            3D
          </button>
        </div>
        <select className="dm-city-select" value={cityId} onChange={(e) => onCityChange(e.target.value as CityId)}>
          {CITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="dm-search">
          <SearchIcon size={14} />
          <span>Search this area</span>
        </div>
        <button type="button" className="dm-icon-btn" disabled title="Not yet implemented">
          <FilterIcon />
          Filters
        </button>
        <button type="button" className="dm-icon-btn dm-expand-btn" onClick={onToggleExpanded} title={expanded ? "Collapse" : "Expand"}>
          <ExpandIcon />
        </button>
      </div>

      <div ref={containerRef} className="dm-canvas" />

      {!mapReady && !error && <div className="dm-loading">Loading map…</div>}
      {error && <div className="dm-error">Map error: {error}</div>}
      <div className="dm-caption">{cityLabel}</div>
    </div>
  );
}
