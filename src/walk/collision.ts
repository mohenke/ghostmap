// ── Walk mode collision (pure TypeScript) ──────────────────────────────────
// Building footprints and water are obstacles; bridges over water are walkable.
// A uniform grid keeps lookups cheap. World coordinates: x = east, z = south.

type LatLng = { lat: number; lng?: number; lon?: number };
type Proj = { refLat: number; refLng: number; scaleX: number; scaleY: number; bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } };

type Polygon = { pts: Array<[number, number]>; minX: number; maxX: number; minZ: number; maxZ: number };
type Segment = { ax: number; az: number; bx: number; bz: number; halfWidth: number };

const CELL = 10;

export type Collider = {
  blocked: (x: number, z: number, r: number) => boolean;
  /** Tries the full step, then sliding along x or z. Returns the new position. */
  move: (x: number, z: number, dx: number, dz: number, r: number) => [number, number];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

function toWorld(p: Proj, pt: LatLng): [number, number] {
  const lng = pt.lng ?? pt.lon ?? 0;
  return [(lng - p.refLng) * p.scaleX, -(pt.lat - p.refLat) * p.scaleY];
}

function pointInPolygon(x: number, z: number, pts: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

export function buildCollider(
  p: Proj,
  buildings: Array<{ geometry?: LatLng[] }>,
  water: Array<{ ring: LatLng[] }>,
  bridges: Array<{ geometry: LatLng[]; halfWidth: number }>
): Collider {
  const grid = new Map<string, Polygon[]>();
  const add = (ring: LatLng[]) => {
    if (!ring || ring.length < 3) return;
    const pts = ring.map((pt) => toWorld(p, pt));
    const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
    const poly: Polygon = { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    for (let cx = Math.floor(poly.minX / CELL); cx <= Math.floor(poly.maxX / CELL); cx++) {
      for (let cz = Math.floor(poly.minZ / CELL); cz <= Math.floor(poly.maxZ / CELL); cz++) {
        const key = `${cx},${cz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(poly);
      }
    }
  };
  buildings.forEach((b) => b.geometry && add(b.geometry));
  water.forEach((w) => add(w.ring));

  const bridgeSegs: Segment[] = [];
  for (const b of bridges) {
    for (let i = 0; i < b.geometry.length - 1; i++) {
      const [ax, az] = toWorld(p, b.geometry[i]);
      const [bx, bz] = toWorld(p, b.geometry[i + 1]);
      bridgeSegs.push({ ax, az, bx, bz, halfWidth: b.halfWidth });
    }
  }

  const [minX, maxZ] = toWorld(p, { lat: p.bbox.minLat, lng: p.bbox.minLng });
  const [maxX, minZ] = toWorld(p, { lat: p.bbox.maxLat, lng: p.bbox.maxLng });
  const bounds = { minX, maxX, minZ, maxZ };

  const onBridge = (x: number, z: number) => bridgeSegs.some((s) => distToSegment(x, z, s.ax, s.az, s.bx, s.bz) <= s.halfWidth);

  const blocked = (x: number, z: number, r: number) => {
    if (x < bounds.minX + r || x > bounds.maxX - r || z < bounds.minZ + r || z > bounds.maxZ - r) return true;
    const seen = new Set<Polygon>();
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        for (const poly of grid.get(`${cx},${cz}`) ?? []) {
          if (seen.has(poly)) continue;
          seen.add(poly);
          if (x < poly.minX - r || x > poly.maxX + r || z < poly.minZ - r || z > poly.maxZ + r) continue;
          let hit = pointInPolygon(x, z, poly.pts);
          if (!hit) {
            for (let i = 0, j = poly.pts.length - 1; i < poly.pts.length; j = i++) {
              if (distToSegment(x, z, poly.pts[j][0], poly.pts[j][1], poly.pts[i][0], poly.pts[i][1]) < r) { hit = true; break; }
            }
          }
          if (hit && !onBridge(x, z)) return true;
        }
      }
    }
    return false;
  };

  const move = (x: number, z: number, dx: number, dz: number, r: number): [number, number] => {
    // If we somehow start inside an obstacle, let the player walk out of it.
    if (blocked(x, z, r)) return [x + dx, z + dz];
    if (!blocked(x + dx, z + dz, r)) return [x + dx, z + dz];
    if (!blocked(x + dx, z, r)) return [x + dx, z];
    if (!blocked(x, z + dz, r)) return [x, z + dz];
    return [x, z];
  };

  return { blocked, move, bounds };
}
