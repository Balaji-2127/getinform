import Supercluster, { type ClusterFeature, type PointFeature } from "supercluster";
import type { ScreenFeatureCollection } from "../data/cities";

export type ProjectFeature = ScreenFeatureCollection["features"][number];
type ProjectProps = ProjectFeature["properties"];

// Supercluster bins points against an abstract "zoom" concept purely for
// clustering granularity — it has nothing to do with Google's camera
// (range/tilt/heading). We just walk that abstract zoom up as the user
// drills in, using each cluster's own `getClusterExpansionZoom` to know
// how far to walk it, exactly mirroring how MapLibre's built-in GeoJSON
// clustering was driven before — just decoupled from the map engine now.
export const CLUSTER_RADIUS = 60;
export const CLUSTER_MAX_ZOOM = 14;
export const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];

export function buildClusterIndex(fc: ScreenFeatureCollection): Supercluster<ProjectProps, ProjectProps> {
  const index = new Supercluster<ProjectProps, ProjectProps>({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM });
  const points: PointFeature<ProjectProps>[] = fc.features.map((f) => ({
    type: "Feature",
    properties: f.properties,
    geometry: f.geometry,
  }));
  index.load(points);
  return index;
}

export type ClusterOrPoint =
  | { kind: "cluster"; id: number; longitude: number; latitude: number; pointCount: number }
  | { kind: "point"; longitude: number; latitude: number; feature: ProjectFeature };

export function isClusterFeature(f: ClusterFeature<ProjectProps> | PointFeature<ProjectProps>): f is ClusterFeature<ProjectProps> {
  return "cluster" in f.properties && (f.properties as { cluster?: boolean }).cluster === true;
}

export function toClusterOrPoint(f: ClusterFeature<ProjectProps> | PointFeature<ProjectProps>): ClusterOrPoint {
  const [longitude, latitude] = f.geometry.coordinates;
  if (isClusterFeature(f)) {
    return { kind: "cluster", id: f.properties.cluster_id, longitude, latitude, pointCount: f.properties.point_count };
  }
  return {
    kind: "point",
    longitude,
    latitude,
    feature: { type: "Feature", geometry: f.geometry, properties: f.properties } as ProjectFeature,
  };
}

export function getLeavesAsFeatures(index: Supercluster<ProjectProps, ProjectProps>, clusterId: number): ProjectFeature[] {
  return index.getLeaves(clusterId, Infinity).map((f) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [f.geometry.coordinates[0], f.geometry.coordinates[1]] },
    properties: f.properties,
  }));
}
