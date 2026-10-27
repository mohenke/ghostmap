// Simulated ghost energy at a point – used by the handheld meter in walk mode
// and by the building card. Combines nearby sensors, wisps and energy flows.
import { METERS_PER_UNIT } from "@/three/geo";
import { useGhostStore } from "./ghostStore.ts";
import { pointAt } from "./streetGraph.ts";
import type { GhostEntity } from "./types.ts";

/** Current world position of a wisp from its route, start time and speed. */
export function wispPosition(e: GhostEntity, now = Date.now()) {
  return pointAt(e.path, ((now - e.startedAt) / 1000) * e.speed);
}

/** What a handheld ghost meter would read at this spot (0–100). */
export function localGhostEnergy(p: { x: number; y: number; z: number }, noise = true) {
  const g = useGhostStore.getState();
  if (!g.ghostMode) return { value: 0, nearestWispM: null };
  const parts: number[] = [];
  for (const s of g.sensors) {
    const r = g.readings[s.sensor_id];
    if (!r || !s.position) continue;
    const e = r.ghost_energy;
    const radius = (5 + (e / 100) * 16) * 1.3; // a bit wider than the visible energy field
    const d = Math.hypot(s.position[0] - p.x, s.position[1] - p.y, s.position[2] - p.z);
    parts.push(e * Math.exp(-((d / radius) ** 2)));
  }
  let nearest = Infinity;
  for (const w of g.entities) {
    const wp = wispPosition(w);
    const d = Math.hypot(wp.x - p.x, wp.z - p.z);
    nearest = Math.min(nearest, d);
    parts.push(100 * w.intensity * Math.exp(-((d / 12) ** 2)));
  }
  for (const f of g.flows) {
    let best = Infinity;
    const pts = f.path.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(ax + dx * t - p.x, az + dz * t - p.z));
    }
    if (best < 5) parts.push(45 * f.intensity * (1 - best / 5));
  }
  parts.sort((a, b) => b - a);
  const value = Math.min(100, (parts[0] ?? 0) + 0.25 * parts.slice(1).reduce((s, v) => s + v, 0) + (noise ? (Math.random() - 0.5) * 3 : 0));
  return { value: Math.max(0, value), nearestWispM: isFinite(nearest) ? nearest * METERS_PER_UNIT : null };
}
