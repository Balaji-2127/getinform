// Camera-framing math for Map3DElement. Its camera model is
// center(lat,lng,altitude) + range (meters, camera-to-center distance) +
// tilt (0=straight down, degrees) + heading (compass degrees) — distance
// based, not zoom-level based like MapLibre. There's no built-in
// "fitBounds" for the 3D element, so this derives a reasonable range from
// a geographic bounding box's diagonal extent, then leaves the exact
// multiplier to be tuned against how it actually looks (the same way the
// MapLibre version's zoom floors were tuned empirically, not derived from
// first-principles optics).

export type Bbox = [[number, number], [number, number]]; // [[minLng,minLat],[maxLng,maxLat]]

const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bboxCenter(bbox: Bbox): { lat: number; lng: number } {
  const [[minLng, minLat], [maxLng, maxLat]] = bbox;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

export function bboxDiagonalMeters(bbox: Bbox): number {
  const [[minLng, minLat], [maxLng, maxLat]] = bbox;
  return haversineMeters(minLat, minLng, maxLat, maxLng);
}

/**
 * Range (meters) that frames a bbox's diagonal extent, clamped to a
 * sensible band. `factor` is the empirical tuning knob — bigger frames
 * the area wider, smaller zooms in tighter relative to the same bbox.
 */
export function rangeForBbox(bbox: Bbox, opts: { factor: number; minRange: number; maxRange: number }): number {
  const diagonal = bboxDiagonalMeters(bbox);
  return Math.min(opts.maxRange, Math.max(opts.minRange, diagonal * opts.factor));
}

export function expandBbox(bbox: Bbox, marginMeters: number): Bbox {
  const [[minLng, minLat], [maxLng, maxLat]] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  const dLat = marginMeters / 110_540;
  const dLng = marginMeters / (111_320 * Math.cos(toRad(centerLat)));
  return [
    [minLng - dLng, minLat - dLat],
    [maxLng + dLng, maxLat + dLat],
  ];
}

/**
 * A regular polygon of `segments` points approximating a circle of
 * `radiusMeters` around `center`, each carrying the same `altitude` — used
 * to draw a Polygon3DElement around a point location (we only ever have a
 * project's lat/lng, never its real building footprint, so this is a
 * deliberately generic stand-in shape rather than a traced outline).
 */
export function circlePathAround(
  center: { lat: number; lng: number },
  radiusMeters: number,
  altitude: number,
  segments = 24,
): { lat: number; lng: number; altitude: number }[] {
  const latMetersPerDegree = 110_540;
  const lngMetersPerDegree = 111_320 * Math.cos(toRad(center.lat));
  const path: { lat: number; lng: number; altitude: number }[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    path.push({
      lat: center.lat + (Math.cos(angle) * radiusMeters) / latMetersPerDegree,
      lng: center.lng + (Math.sin(angle) * radiusMeters) / lngMetersPerDegree,
      altitude,
    });
  }
  return path;
}

export function bboxOfPoints(points: { lng: number; lat: number }[]): Bbox | null {
  if (points.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
