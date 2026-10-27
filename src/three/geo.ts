// Shared helpers for turning OSM data into scene units.
//
// Projection (see areaStore.Projection):
//   shape x = (lng - refLng) * scaleX,  shape y = (lat - refLat) * scaleY
// Shapes are extruded upwards and rotated -90° around X, so in world space:
//   X = shape x,  Y = height,  Z = -shape y

import * as THREE from "three";
import type { Projection } from "@/state/areaStore";

/** SCENE_SCALE is 51 000 units per degree latitude ≈ 111 320 m → 1 unit ≈ 2.18 m. */
export const METERS_PER_UNIT = 111320 / 51000;

const METERS_PER_LEVEL = 3.0;
/** One storey in scene units. */
export const LEVEL_UNITS = METERS_PER_LEVEL / METERS_PER_UNIT;

// Typical number of storeys when OSM has no `building:levels`.
// Haga is dominated by 3–4 storey landshövdingehus and stone apartment blocks.
const DEFAULT_LEVELS: Record<string, number> = {
  apartments: 4,
  residential: 4,
  university: 4,
  civic: 3,
  commercial: 3,
  office: 4,
  retail: 2,
  house: 2,
  detached: 2,
  church: 3,
  kiosk: 1,
  shelter: 1,
  hut: 1,
  shed: 1,
  garage: 1,
  garages: 1,
  roof: 1,
};

/** Number of storeys from OSM tags (falls back to a per-type default). */
export function buildingLevels(tags: Record<string, string> = {}): number {
  const levels = parseFloat(tags["building:levels"] || "");
  if (!isNaN(levels) && levels > 0) return levels;
  return DEFAULT_LEVELS[tags.building] ?? 3;
}

/**
 * Total building height in scene units, including the roof.
 * Uses OSM `height` when present, otherwise storeys × 3 m (+1 m for the base).
 */
export function buildingHeight(tags: Record<string, string> = {}): number {
  const h = parseFloat(tags.height || "");
  if (!isNaN(h) && h > 0) return h / METERS_PER_UNIT;
  const roof = parseFloat(tags["roof:levels"] || "") || 0;
  return ((buildingLevels(tags) + roof) * METERS_PER_LEVEL + 1) / METERS_PER_UNIT;
}

/** lat/lon → world-space [x, z]. */
export function projectToWorld(p: Projection, lat: number, lng: number): [number, number] {
  return [(lng - p.refLng) * p.scaleX, -(lat - p.refLat) * p.scaleY];
}

/**
 * Footprint ring (lat/lng) → shape-space points: counter-clockwise and without
 * the closing duplicate, which is what the roof and wall builders expect.
 */
export function footprintToShape(p: Projection, ring: Array<{ lat: number; lng: number }>): THREE.Vector2[] {
  const pts = ring.map((pt) => new THREE.Vector2((pt.lng - p.refLng) * p.scaleX, (pt.lat - p.refLat) * p.scaleY));
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) pts.reverse();
  return pts;
}

/** Ray-casting point-in-polygon test in lat/lng space. */
export function pointInRing(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > lat !== b.lat > lat && lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}
