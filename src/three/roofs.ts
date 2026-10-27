// Building geometry with walls, pitched roofs and per-building colours.
//
// A roof is modelled as the *minimum of a few sloping planes* over the
// building's oriented bounding box (OBB):
//   gabled    – 2 planes meeting at a ridge along the long axis
//   hipped    – the gable planes + 2 end planes with the same slope
//   pyramidal – 4 planes meeting at the centre
//   flat      – no planes
// Every plane is drawn only where it is the lowest one, which splits any
// footprint (also L-shaped or irregular ones) into flat roof faces. The walls
// follow the roof line, so gable ends are closed automatically.
//
// Coordinates: shape space (x = east, y = north) → world (x, height, -y).

import * as THREE from "three";
import { LEVEL_UNITS, METERS_PER_UNIT, buildingHeight, buildingLevels } from "./geo";

export type RoofKind = "flat" | "gabled" | "hipped" | "pyramidal";

/** h(p) = a + bx * p.x + by * p.y, in scene units above the wall top. */
type Plane = { a: number; bx: number; by: number };

export type RoofPlan = {
  kind: RoofKind;
  wall: number;
  roof: number;
  /** Highest point of the building (wall + roof). */
  top: number;
  planes: Plane[];
};

type Tags = Record<string, string>;

const PITCHED_TYPES = new Set(["apartments", "residential", "house", "detached", "yes", "civic", "church", "kiosk", "hut", "shed", "terrace"]);
const LARGE_FOOTPRINT = 900; // scene units² ≈ 4 300 m² – big blocks get flat roofs by default

// ── geometry helpers ───────────────────────────────────────────────────────

export function polygonArea(pts: THREE.Vector2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function convexHull(pts: THREE.Vector2[]): THREE.Vector2[] {
  const s = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: THREE.Vector2[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

type OBB = { c: THREE.Vector2; u: THREE.Vector2; v: THREE.Vector2; a: number; b: number; area: number };

/** Minimum-area oriented bounding box; `u` is the long axis, a ≥ b are half-lengths. */
function orientedBox(pts: THREE.Vector2[]): OBB {
  const hull = convexHull(pts);
  let best: OBB | null = null;
  for (let i = 0; i < hull.length; i++) {
    const e = hull[(i + 1) % hull.length].clone().sub(hull[i]);
    if (e.lengthSq() < 1e-10) continue;
    const u = e.normalize();
    const v = new THREE.Vector2(-u.y, u.x);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const pu = p.dot(u), pv = p.dot(v);
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const c = u.clone().multiplyScalar((minU + maxU) / 2).add(v.clone().multiplyScalar((minV + maxV) / 2));
      best = { c, u: u.clone(), v, a: (maxU - minU) / 2, b: (maxV - minV) / 2, area };
    }
  }
  if (!best) return { c: pts[0].clone(), u: new THREE.Vector2(1, 0), v: new THREE.Vector2(0, 1), a: 0, b: 0, area: 0 };
  if (best.b > best.a) {
    // make u the long axis
    best = { ...best, u: best.v.clone(), v: best.u.clone().negate(), a: best.b, b: best.a };
  }
  return best;
}

/** Plane falling from height `h0` at the OBB centre with slope `-k` along `dir`. */
function slopePlane(c: THREE.Vector2, dir: THREE.Vector2, h0: number, k: number): Plane {
  // h = h0 - k * dot(p - c, dir)
  return { a: h0 + k * c.dot(dir), bx: -k * dir.x, by: -k * dir.y };
}

const evalPlane = (pl: Plane, x: number, y: number) => pl.a + pl.bx * x + pl.by * y;

function roofHeightAt(planes: Plane[], x: number, y: number) {
  if (planes.length === 0) return 0;
  let h = Infinity;
  for (const pl of planes) h = Math.min(h, evalPlane(pl, x, y));
  return Math.max(0, h);
}

/** Sutherland–Hodgman clip of a polygon against f(p) ≤ 0 for an affine f. */
function clipHalfPlane(poly: THREE.Vector2[], f: (p: THREE.Vector2) => number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    const aIn = fa <= 1e-9, bIn = fb <= 1e-9;
    if (aIn) out.push(a);
    if (aIn !== bIn) out.push(a.clone().lerp(b, fa / (fa - fb)));
  }
  return out;
}

// ── roof plan ──────────────────────────────────────────────────────────────

function roofKind(tags: Tags, rectangularity: number, footprintArea: number): RoofKind {
  const shape = (tags["roof:shape"] || "").toLowerCase();
  if (shape) {
    if (shape === "flat") return "flat";
    if (["gabled", "round", "gambrel", "saltbox"].includes(shape)) return "gabled";
    if (["pyramidal", "dome", "onion", "cone"].includes(shape)) return "pyramidal";
    return "hipped";
  }
  const pitched = PITCHED_TYPES.has(tags.building) || parseFloat(tags["roof:levels"] || "") > 0;
  if (!pitched || footprintArea > LARGE_FOOTPRINT) return "flat";
  return rectangularity > 0.8 ? "gabled" : "hipped";
}

export function roofPlan(pts: THREE.Vector2[], tags: Tags = {}): RoofPlan {
  const area = Math.abs(polygonArea(pts));
  const box = orientedBox(pts);
  const kind = box.b < 0.4 ? "flat" : roofKind(tags, box.area > 0 ? area / box.area : 0, area);

  // Roof height: explicit tag, roof storeys, or a ~37° pitch capped at 1.3 storeys.
  let roof = 0;
  if (kind !== "flat") {
    const roofHeightTag = parseFloat(tags["roof:height"] || "");
    const roofLevels = parseFloat(tags["roof:levels"] || "");
    if (!isNaN(roofHeightTag) && roofHeightTag > 0) roof = roofHeightTag / METERS_PER_UNIT;
    else if (!isNaN(roofLevels) && roofLevels > 0) roof = roofLevels * LEVEL_UNITS;
    else roof = Math.min(box.b * 0.75, 1.3 * LEVEL_UNITS);
  }

  // Wall height: OSM `height` is the total, otherwise storeys × 3 m + 1 m base.
  const totalTag = parseFloat(tags.height || "");
  const wall = !isNaN(totalTag) && totalTag > 0
    ? Math.max(1, buildingHeight(tags) - roof)
    : (buildingLevels(tags) * 3 + 1) / METERS_PER_UNIT;

  const planes: Plane[] = [];
  if (kind !== "flat") {
    let { u, v, a, b } = box;
    if (kind === "gabled" && (tags["roof:orientation"] || "") === "across") {
      [u, v, a, b] = [v, u.clone().negate(), b, a];
    }
    const k = roof / Math.max(b, 1e-3); // slope of the long roof faces
    planes.push(slopePlane(box.c, v, roof, k), slopePlane(box.c, v.clone().negate(), roof, k));
    if (kind === "hipped") {
      planes.push(slopePlane(box.c, u, k * a, k), slopePlane(box.c, u.clone().negate(), k * a, k));
    } else if (kind === "pyramidal") {
      const ku = roof / Math.max(a, 1e-3);
      planes.push(slopePlane(box.c, u, roof, ku), slopePlane(box.c, u.clone().negate(), roof, ku));
    }
  }

  return { kind, wall, roof, top: wall + roof, planes };
}

// ── colours ────────────────────────────────────────────────────────────────

// Haga-like facade palette: ochre, beige, pale yellow, brick and off-white.
const FACADE_PALETTE = ["#d8c39a", "#e4d3a8", "#c9a66b", "#b5654a", "#e8dcc4", "#cdb38b", "#a9775a", "#d9b98c"].map(
  (c) => new THREE.Color(c)
);
const MATERIAL_COLOUR: Record<string, string> = { brick: "#9c5a3c", glass: "#7d8c99", wood: "#c9a66b", stone: "#a8a294", metal: "#8a8f96", plaster: "#e2d6bd" };
const ROOF_PALETTE = ["#8e4a3a", "#7a3f33", "#4a4f55", "#5b5f63"].map((c) => new THREE.Color(c));
const FLAT_ROOF = new THREE.Color("#5f6062");
const NEUTRAL = new THREE.Color("#8a8a8a");

function parseColour(value: string | undefined): THREE.Color | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return new THREE.Color(v);
  if (v in THREE.Color.NAMES) {
    // Pure CSS colours are very saturated – soften them towards grey.
    return new THREE.Color(v).lerp(NEUTRAL, 0.3);
  }
  return null;
}

function stableIndex(id: number | string, n: number, salt = 0) {
  const s = String(id);
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) % n;
}

export function buildingColours(tags: Tags, id: number | string, kind: RoofKind) {
  const facade =
    parseColour(tags["building:colour"]) ??
    (tags["building:material"] && MATERIAL_COLOUR[tags["building:material"]] ? new THREE.Color(MATERIAL_COLOUR[tags["building:material"]]) : null) ??
    FACADE_PALETTE[stableIndex(id, FACADE_PALETTE.length)].clone();
  const roof =
    parseColour(tags["roof:colour"]) ?? (kind === "flat" ? FLAT_ROOF.clone() : ROOF_PALETTE[stableIndex(id, ROOF_PALETTE.length, 7)].clone());
  return { facade, roof };
}

// ── mesh ───────────────────────────────────────────────────────────────────

export type BuildingModel = { geometry: THREE.BufferGeometry; plan: RoofPlan };

export type BuildingPlacement = {
  /** Scene height of the building's ground floor (lowest terrain point under it). */
  base?: number;
  /** How far the walls continue below `base`, so sloping ground never shows a gap. */
  drop?: number;
};

/** Walls + roof as one non-indexed geometry with per-vertex colours. */
export function buildBuildingGeometry(pts: THREE.Vector2[], tags: Tags, id: number | string, place: BuildingPlacement = {}): BuildingModel {
  const base = place.base ?? 0;
  const bottom = base - (place.drop ?? 0);
  const plan = roofPlan(pts, tags);
  const { wall, planes } = plan;
  const { facade, roof } = buildingColours(tags, id, plan.kind);
  const pos: number[] = [];
  const col: number[] = [];

  const push = (x: number, h: number, y: number, c: THREE.Color) => {
    pos.push(x, h + base, -y);
    col.push(c.r, c.g, c.b);
  };
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], colour: THREE.Color, wantUp: boolean) => {
    if (wantUp) {
      // world normal y = (b-a) × (c-a), with world z = -shape y
      const ny = -((b[0] - a[0]) * (a[2] - c[2]) - (a[2] - b[2]) * (c[0] - a[0]));
      if (ny < 0) [b, c] = [c, b];
    }
    for (const p of [a, b, c]) push(p[0], p[1], p[2], colour);
  };

  // Walls, following the roof line so gables are closed.
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const ts = [0, 1];
    for (let m = 0; m < planes.length; m++) {
      for (let n = m + 1; n < planes.length; n++) {
        const g0 = evalPlane(planes[m], p.x, p.y) - evalPlane(planes[n], p.x, p.y);
        const g1 = evalPlane(planes[m], q.x, q.y) - evalPlane(planes[n], q.x, q.y);
        if (g0 * g1 < 0) ts.push(g0 / (g0 - g1));
      }
    }
    ts.sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k++) {
      const a = p.clone().lerp(q, ts[k]);
      const b = p.clone().lerp(q, ts[k + 1]);
      if (a.distanceToSquared(b) < 1e-12) continue;
      const ha = wall + roofHeightAt(planes, a.x, a.y);
      const hb = wall + roofHeightAt(planes, b.x, b.y);
      const lo = bottom - base; // relative to base (push adds base)
      tri([a.x, lo, a.y], [b.x, lo, b.y], [b.x, hb, b.y], facade, false);
      tri([a.x, lo, a.y], [b.x, hb, b.y], [a.x, ha, a.y], facade, false);
    }
  }

  // Roof faces: each plane where it is the lowest.
  const faces = planes.length ? planes : [{ a: 0, bx: 0, by: 0 }];
  faces.forEach((pl, i) => {
    let region = pts;
    faces.forEach((other, j) => {
      if (i === j || region.length < 3) return;
      region = clipHalfPlane(region, (p) => evalPlane(pl, p.x, p.y) - evalPlane(other, p.x, p.y));
    });
    if (region.length < 3) return;
    const idx = THREE.ShapeUtils.triangulateShape(region, []);
    for (const [ia, ib, ic] of idx) {
      const v = [region[ia], region[ib], region[ic]].map((p) => [p.x, wall + Math.max(0, evalPlane(pl, p.x, p.y)), p.y] as [number, number, number]);
      tri(v[0], v[1], v[2], roof, true);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // THREE.Color already converts hex/CSS (sRGB) to linear, which vertex colours expect.
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  // Ground-floor height per vertex: the facade shader counts storeys from here.
  geometry.setAttribute("aBase", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(base), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, plan };
}
