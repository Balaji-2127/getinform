// A fictional gated community, invented for this demo — not a real place.
// It stands in for the kind of accurate, per-tower data you'd get from a
// builder's site plan/RERA filing, as opposed to OSM's flat, height-less
// footprints. Compare against osmGapSample.json, which IS real OSM data.

const CENTER: [number, number] = [78.37, 17.47];

// Rough local meters-per-degree at this latitude — good enough for a demo
// layout, not for surveying.
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((17.47 * Math.PI) / 180);

function rect(
  offsetXMeters: number,
  offsetYMeters: number,
  widthMeters: number,
  depthMeters: number,
): [number, number][] {
  const cx = CENTER[0] + offsetXMeters / M_PER_DEG_LON;
  const cy = CENTER[1] + offsetYMeters / M_PER_DEG_LAT;
  const hw = widthMeters / 2 / M_PER_DEG_LON;
  const hd = depthMeters / 2 / M_PER_DEG_LAT;
  const ring: [number, number][] = [
    [cx - hw, cy - hd],
    [cx + hw, cy - hd],
    [cx + hw, cy + hd],
    [cx - hw, cy + hd],
    [cx - hw, cy - hd],
  ];
  return ring;
}

type Block = {
  name: string;
  kind: "residential" | "amenity";
  floors: number;
  offset: [number, number];
  size: [number, number];
};

const BLOCKS: Block[] = [
  { name: "Tower A", kind: "residential", floors: 20, offset: [-70, 40], size: [30, 30] },
  { name: "Tower B", kind: "residential", floors: 18, offset: [0, 55], size: [30, 30] },
  { name: "Tower C", kind: "residential", floors: 15, offset: [70, 40], size: [28, 28] },
  { name: "Tower D", kind: "residential", floors: 12, offset: [-70, -40], size: [26, 26] },
  { name: "Tower E", kind: "residential", floors: 12, offset: [70, -40], size: [26, 26] },
  { name: "Clubhouse", kind: "amenity", floors: 3, offset: [0, -55], size: [40, 22] },
];

const FLOOR_HEIGHT_M = 3;

export const sampleCommunity = {
  type: "FeatureCollection" as const,
  features: BLOCKS.map((b) => ({
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [rect(b.offset[0], b.offset[1], b.size[0], b.size[1])] },
    properties: {
      name: b.name,
      kind: b.kind,
      floors: b.floors,
      height_m: b.floors * FLOOR_HEIGHT_M,
    },
  })),
};

export const SAMPLE_COMMUNITY_CENTER = CENTER;
