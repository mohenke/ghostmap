// Terrain: a regular height grid over the selected area.
//
// Haga uses a bundled grid (public/data/haga-terrain.json, made by
// scripts/make_terrain.py). Other areas fetch Terrarium elevation tiles from
// AWS Open Data at runtime and build the same grid in the browser.
// Heights are stored in metres; scene heights are relative to the lowest point
// of the selected area, in scene units (1 unit ≈ 2.18 m).
//
// To use a more precise source later (e.g. Lantmäteriet 1 m or Göteborgs Stad
// höjdmodell), produce the same TerrainGrid JSON and load it instead.

import * as THREE from "three";
import type { Projection } from "@/state/areaStore";
import { METERS_PER_UNIT } from "./geo";

export type TerrainGrid = {
  south: number;
  west: number;
  north: number;
  east: number;
  nx: number;
  ny: number;
  /** Row-major, rows south → north, columns west → east. */
  heights_m: number[];
  /** Height (m) that maps to scene y = 0. */
  base_m: number;
};

/** Grid height in metres at lat/lon (bilinear). */
function heightMeters(t: TerrainGrid, lat: number, lon: number): number {
  const fx = THREE.MathUtils.clamp(((lon - t.west) / (t.east - t.west)) * (t.nx - 1), 0, t.nx - 1);
  const fy = THREE.MathUtils.clamp(((lat - t.south) / (t.north - t.south)) * (t.ny - 1), 0, t.ny - 1);
  const i = Math.min(t.nx - 2, Math.floor(fx));
  const j = Math.min(t.ny - 2, Math.floor(fy));
  const u = fx - i;
  const v = fy - j;
  const h = (ii: number, jj: number) => t.heights_m[jj * t.nx + ii];
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** Scene height (units) at lat/lon. Returns 0 without terrain. */
export function groundAt(t: TerrainGrid | null, lat: number, lon: number): number {
  if (!t) return 0;
  return Math.max(0, heightMeters(t, lat, lon) - t.base_m) / METERS_PER_UNIT;
}

/** Scene height (units) at a world position (x, z). */
export function groundAtWorld(t: TerrainGrid | null, p: Projection, x: number, z: number): number {
  if (!t) return 0;
  return groundAt(t, p.refLat - z / p.scaleY, p.refLng + x / p.scaleX);
}

/** Uses the lowest point inside the selected bbox as scene y = 0. */
export function withBase(grid: Omit<TerrainGrid, "base_m">, p: Projection): TerrainGrid {
  let min = Infinity;
  for (let j = 0; j < grid.ny; j++) {
    const lat = grid.south + ((grid.north - grid.south) * j) / (grid.ny - 1);
    if (lat < p.bbox.minLat || lat > p.bbox.maxLat) continue;
    for (let i = 0; i < grid.nx; i++) {
      const lon = grid.west + ((grid.east - grid.west) * i) / (grid.nx - 1);
      if (lon < p.bbox.minLng || lon > p.bbox.maxLng) continue;
      min = Math.min(min, grid.heights_m[j * grid.nx + i]);
    }
  }
  return { ...grid, base_m: isFinite(min) ? min : 0 };
}

/**
 * Lifts every vertex of a flat geometry onto the terrain.
 * `toWorld` maps a local vertex to world (x, z); `lift` is the local axis that points up.
 */
export function drapeGeometry(
  geometry: THREE.BufferGeometry,
  t: TerrainGrid | null,
  p: Projection,
  toWorld: (x: number, y: number, z: number) => [number, number],
  lift: "y" | "z"
) {
  if (!t) return geometry;
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [wx, wz] = toWorld(pos.getX(i), pos.getY(i), pos.getZ(i));
    const h = groundAtWorld(t, p, wx, wz);
    if (lift === "y") pos.setY(i, pos.getY(i) + h);
    else pos.setZ(i, pos.getZ(i) + h);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// ── runtime source for areas other than Haga ───────────────────────────────

const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** Builds a grid for any bbox from Terrarium tiles (zoom 15, ~2.5 m/px; real detail is coarser). */
export async function fetchTerrainGrid(p: Projection, size = 65, margin = 1.25): Promise<TerrainGrid> {
  const z = 15;
  const n = 2 ** z;
  const clat = (p.bbox.minLat + p.bbox.maxLat) / 2;
  const clon = (p.bbox.minLng + p.bbox.maxLng) / 2;
  const hlat = ((p.bbox.maxLat - p.bbox.minLat) / 2) * margin;
  const hlon = ((p.bbox.maxLng - p.bbox.minLng) / 2) * margin;
  const south = clat - hlat, north = clat + hlat, west = clon - hlon, east = clon + hlon;
  const tileXY = (lat: number, lon: number) => [((lon + 180) / 360) * n, ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n];

  const tiles = new Map<string, Promise<ImageData>>();
  const loadTile = (tx: number, ty: number) => {
    const key = `${tx}/${ty}`;
    if (!tiles.has(key)) {
      tiles.set(
        key,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
          };
          img.onerror = reject;
          img.src = `${TILE_URL}/${z}/${tx}/${ty}.png`;
        })
      );
    }
    return tiles.get(key)!;
  };

  const heights: number[] = [];
  for (let j = 0; j < size; j++) {
    const lat = south + ((north - south) * j) / (size - 1);
    for (let i = 0; i < size; i++) {
      const lon = west + ((east - west) * i) / (size - 1);
      const [fx, fy] = tileXY(lat, lon);
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const img = await loadTile(tx, ty);
      const px = Math.min(img.width - 1, Math.floor((fx - tx) * img.width));
      const py = Math.min(img.height - 1, Math.floor((fy - ty) * img.height));
      const k = (py * img.width + px) * 4;
      heights.push(img.data[k] * 256 + img.data[k + 1] + img.data[k + 2] / 256 - 32768);
    }
  }
  return withBase({ south, west, north, east, nx: size, ny: size, heights_m: heights }, p);
}

/**
 * Where a building stands: on the lowest ground under its footprint (the uphill
 * side is simply buried in the slope). The walls reach a little further down so
 * no seam shows where the terrain surface dips between grid points.
 */
export function buildingPlacement(t: TerrainGrid | null, ring: Array<{ lat: number; lng: number }>) {
  if (!t) return { base: 0, drop: 0 };
  let min = Infinity;
  for (const pt of ring) min = Math.min(min, groundAt(t, pt.lat, pt.lng));
  return { base: min, drop: 0.4 };
}
