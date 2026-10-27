// Polyline helpers shared by roads, rivers, railways and street details.
// (Moved unchanged from Space.tsx so other scene modules can reuse them.)
import * as THREE from "three";

// Build a flat ribbon THREE.Shape from a projected 2-D polyline.
// Returns null if the polyline is degenerate.
export function buildRoadShape(pts: THREE.Vector2[], halfW: number): THREE.Shape | null {
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Perpendicular unit vector (90° CCW)
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;

    if (left.length === 0) {
      left.push(new THREE.Vector2(a.x + nx, a.y + ny));
      right.push(new THREE.Vector2(a.x - nx, a.y - ny));
    }
    left.push(new THREE.Vector2(b.x + nx, b.y + ny));
    right.push(new THREE.Vector2(b.x - nx, b.y - ny));
  }

  if (left.length < 2) return null;

  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) shape.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(right[i].x, right[i].y);
  shape.closePath();
  return shape;
}

// ── Polyline clipping ─────────────────────────────────────────────────────────

/**
 * Liang-Barsky parametric segment clip against an axis-aligned rectangle.
 * Works in any 2-D coordinate system (lat/lon here).
 * Returns [x0,y0, x1,y1] of the clipped segment, or null if fully outside.
 */
function clipSegment(
  x0: number, y0: number,
  x1: number, y1: number,
  xmin: number, ymin: number,
  xmax: number, ymax: number
): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;        // parallel edge — outside if q < 0
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else       { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };

  if (
    !clip(-dx, x0 - xmin) ||
    !clip( dx, xmax - x0) ||
    !clip(-dy, y0 - ymin) ||
    !clip( dy, ymax - y0)
  ) return null;

  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

export type LatLon = { lat: number; lon: number };

/**
 * Clips a lat/lon polyline to the given bounding box.
 * Returns one or more contiguous sub-polylines (a road crossing a bbox corner
 * may produce two separate segments).
 */
export function clipPolylineToBbox(
  pts: LatLon[],
  minLat: number, maxLat: number,
  minLng: number, maxLng: number
): LatLon[][] {
  const result: LatLon[][] = [];
  let current: LatLon[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const seg = clipSegment(
      p0.lon, p0.lat, p1.lon, p1.lat,
      minLng, minLat, maxLng, maxLat
    );
    if (!seg) {
      if (current.length >= 2) result.push(current);
      current = [];
      continue;
    }
    const [x0, y0, x1, y1] = seg;
    const cp0: LatLon = { lat: y0, lon: x0 };
    const cp1: LatLon = { lat: y1, lon: x1 };

    if (current.length === 0) {
      current.push(cp0, cp1);
    } else {
      const last = current[current.length - 1];
      // If the clipped start equals the last accumulated point, extend;
      // otherwise the segment was clipped at entry — start a new chain.
      if (Math.abs(last.lat - cp0.lat) < 1e-10 && Math.abs(last.lon - cp0.lon) < 1e-10) {
        current.push(cp1);
      } else {
        result.push(current);
        current = [cp0, cp1];
      }
    }
  }
  if (current.length >= 2) result.push(current);
  return result;
}

/** Offsets a 2-D polyline sideways by `d` (positive = left), e.g. for the two rails of a track. */
export function offsetPolyline(pts: THREE.Vector2[], d: number): THREE.Vector2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = b.clone().sub(a);
    if (dir.lengthSq() < 1e-12) return p.clone();
    dir.normalize();
    return new THREE.Vector2(p.x - dir.y * d, p.y + dir.x * d);
  });
}
