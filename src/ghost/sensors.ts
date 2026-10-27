// ── GHOST PULSE – sensor network definition and placement ─────────────────
//
// Sensors are defined in real-world coordinates (lat/lon) and are placed in the
// 3D scene with the same projection Mapforge uses for buildings. A sensor that
// sits inside a building footprint is mounted on that building's roof;
// otherwise it hovers just above street level.

import type { Projection } from "@/state/areaStore";
import { footprintToShape, pointInRing, projectToWorld } from "@/three/geo";
import { buildBuildingGeometry, roofPlan } from "@/three/roofs";
import { buildingPlacement, groundAt, type TerrainGrid } from "@/three/terrain";
import type { SensorDefinition } from "./types.ts";

/** Fictional sensor network in Haga, Göteborg. Baselines are pure invention. */
export const HAGA_SENSORS: SensorDefinition[] = [
  {
    sensor_id: "GP-01",
    name: "Haga Nygata",
    location: "Kaféstråket – kanelbullarnas epicentrum",
    lat: 57.69852, lon: 11.95722,
    baseline: 38,
  },
  {
    sensor_id: "GP-02",
    name: "Skansen Kronan",
    location: "Befästning från 1600-talet på berget",
    lat: 57.69601, lon: 11.95533,
    baseline: 62,
  },
  {
    sensor_id: "GP-03",
    name: "Feskekôrka",
    location: "Fiskhallen som ser ut som en kyrka",
    lat: 57.70101, lon: 11.9578,
    baseline: 47,
  },
  {
    sensor_id: "GP-04",
    name: "Allégården",
    location: "Före detta skolbyggnad vid Pusterviksplatsen",
    lat: 57.69955, lon: 11.95709,
    baseline: 31,
  },
  {
    sensor_id: "GP-05",
    name: "Järntorget",
    location: "Torget där spårvagnar och nattsuddare möts",
    lat: 57.69988, lon: 11.95325,
    baseline: 24,
  },
  {
    sensor_id: "GP-06",
    name: "Mellangatan",
    location: "Trånga gårdar bland landshövdingehusen",
    lat: 57.69805, lon: 11.95385,
    baseline: 35,
  },
];

/** Fictional acoustic sensor listening for werewolves in the park below Skansen Kronan. */
export const ACOUSTIC_SENSORS: SensorDefinition[] = [
  {
    sensor_id: "LJ-01",
    name: "Skansparken",
    location: "Ljudsensor i parken vid foten av Skansen Kronan",
    lat: 57.6968, lon: 11.9547,
    baseline: 0,
  },
];

export function placeAcousticSensors(p: Projection, terrain: TerrainGrid | null): SensorDefinition[] {
  return ACOUSTIC_SENSORS.filter((s) => inBbox(p, s.lat, s.lon)).map((s) => {
    const [x, z] = projectToWorld(p, s.lat, s.lon);
    const ground = groundAt(terrain, s.lat, s.lon);
    return { ...s, position: [x, ground + 2.6, z], ground };
  });
}

type BuildingLike = { id?: number | string; tags?: Record<string, string>; geometry?: Array<{ lat: number; lng: number }> };

const STREET_HOVER = 3.5;
const ROOF_HOVER = 2.5;

function inBbox(p: Projection, lat: number, lon: number) {
  const { minLat, maxLat, minLng, maxLng } = p.bbox;
  return lat >= minLat && lat <= maxLat && lon >= minLng && lon <= maxLng;
}

/** Planned height of a building (walls + roof) – cheap, used for ranking. */
function topHeight(p: Projection, b: BuildingLike): number {
  return roofPlan(footprintToShape(p, b.geometry!), b.tags).top;
}

/** Exact highest point of the rendered building mesh (the Blender step uses the same rule). */
function meshTop(p: Projection, b: BuildingLike, terrain: TerrainGrid | null): number {
  const { geometry } = buildBuildingGeometry(footprintToShape(p, b.geometry!), b.tags ?? {}, b.id ?? 0, buildingPlacement(terrain, b.geometry!));
  geometry.computeBoundingBox();
  const top = geometry.boundingBox!.max.y;
  geometry.dispose();
  return top;
}

function mountHeight(p: Projection, buildings: BuildingLike[], terrain: TerrainGrid | null, lat: number, lon: number): number {
  for (const b of buildings) {
    if (b.geometry && b.geometry.length >= 3 && pointInRing(lat, lon, b.geometry)) {
      return meshTop(p, b, terrain) + ROOF_HOVER;
    }
  }
  return groundAt(terrain, lat, lon) + STREET_HOVER;
}

function centroid(g: Array<{ lat: number; lng: number }>) {
  const lat = g.reduce((s, p) => s + p.lat, 0) / g.length;
  const lng = g.reduce((s, p) => s + p.lng, 0) / g.length;
  return { lat, lng };
}

/**
 * Generic placement for areas other than Haga: pick the tallest buildings that
 * are reasonably spread out, so any generated area gets a sensor network.
 */
function autoSensors(p: Projection, buildings: BuildingLike[], count: number): SensorDefinition[] {
  const spanLat = p.bbox.maxLat - p.bbox.minLat;
  const minDist = spanLat * 0.22;
  const candidates = buildings
    .filter((b) => b.geometry && b.geometry.length >= 3)
    .map((b) => ({ b, c: centroid(b.geometry!), h: topHeight(p, b) }))
    .filter(({ c }) => inBbox(p, c.lat, c.lng))
    .sort((a, b) => b.h - a.h);

  const chosen: typeof candidates = [];
  for (const cand of candidates) {
    const farEnough = chosen.every(
      (o) => Math.hypot(o.c.lat - cand.c.lat, (o.c.lng - cand.c.lng) * Math.cos((p.refLat * Math.PI) / 180)) > minDist
    );
    if (farEnough) chosen.push(cand);
    if (chosen.length >= count) break;
  }

  // Not enough buildings? Fill with points on a ring around the centre.
  while (chosen.length < count) {
    const a = (chosen.length / count) * Math.PI * 2;
    chosen.push({
      b: {},
      c: { lat: p.refLat + Math.sin(a) * spanLat * 0.3, lng: p.refLng + Math.cos(a) * (p.bbox.maxLng - p.bbox.minLng) * 0.3 },
      h: 0,
    });
  }

  const letters = "ABCDEFGHIJ";
  return chosen.map(({ b, c }, i) => ({
    sensor_id: `GP-${String(i + 1).padStart(2, "0")}`,
    name: b.tags?.name ?? `Sektor ${letters[i]}`,
    location: b.tags?.["addr:street"] ? `${b.tags["addr:street"]} ${b.tags["addr:housenumber"] ?? ""}`.trim() : "Automatiskt placerad sensor",
    lat: c.lat,
    lon: c.lng,
    baseline: 22 + ((i * 37) % 40),
  }));
}

/**
 * Returns the sensor network for the current scene with resolved 3D positions.
 * Uses the hand-picked Haga sensors when the selected area covers Haga,
 * otherwise places sensors automatically.
 */
/** Real Wikipedia places near a sensor raise its baseline: older, storied places are "more haunted". */
const HISTORY_RADIUS_M = 130;
type PlaceLike = { title: string; lat: number; lon: number };

function historyCharge(s: { lat: number; lon: number }, places: PlaceLike[]) {
  const near = places.filter((h) => {
    const dx = (h.lon - s.lon) * Math.cos((s.lat * Math.PI) / 180) * 111320;
    const dy = (h.lat - s.lat) * 111320;
    return Math.hypot(dx, dy) < HISTORY_RADIUS_M && !/^Haga, Göteborg$/.test(h.title);
  });
  // Diminishing returns: 1 place ≈ +2, 5 ≈ +6, 12+ ≈ +9 (max 10) – keeps the places distinct.
  return { boost: Math.round(10 * (1 - Math.exp(-near.length / 6))), names: near.map((h) => h.title) };
}

export function placeSensors(p: Projection, buildings: BuildingLike[], terrain: TerrainGrid | null = null, history: PlaceLike[] = []): SensorDefinition[] {
  const haga = HAGA_SENSORS.filter((s) => inBbox(p, s.lat, s.lon));
  const defs = haga.length >= 4 ? haga : autoSensors(p, buildings, 6);

  return defs.map((s) => {
    const [x, z] = projectToWorld(p, s.lat, s.lon);
    const charge = historyCharge(s, history);
    return {
      ...s,
      baseline: Math.min(85, s.baseline + charge.boost),
      history_boost: charge.boost,
      history_nearby: charge.names,
      position: [x, mountHeight(p, buildings, terrain, s.lat, s.lon), z],
      ground: groundAt(terrain, s.lat, s.lon),
    };
  });
}
