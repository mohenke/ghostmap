// ── Street network graph (pure TypeScript – no Three.js) ───────────────────
// Built from the OSM highways in the scene. Used by the ghost simulation
// (wisps and energy flows move along real streets) and by the walk mode
// (street name under your feet).
//
// World coordinates follow the scene: x = east, z = south (z = -north).

import type { StreetPath } from "./types.ts";

export type RoadLike = { id?: number | string; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> };
export type ProjectionLike = {
  refLat: number;
  refLng: number;
  scaleX: number;
  scaleY: number;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

type Edge = { to: number; length: number; name: string };

export type StreetGraph = {
  /** Node positions, world [x, z]. */
  nodes: Array<[number, number]>;
  adjacency: Edge[][];
  /** Every edge once (a < b), for nearest-street lookups. */
  segments: Array<{ a: number; b: number; name: string }>;
};

const SKIP = new Set(["construction", "proposed", "platform", "elevator", "corridor", "bus_stop"]);

/** Human-readable street name for an OSM highway. */
function streetName(tags: Record<string, string> = {}): string {
  if (tags.name) return tags.name;
  switch (tags.highway) {
    case "footway": case "path": case "pedestrian": return "gångväg";
    case "steps": return "trappa";
    case "cycleway": return "cykelbana";
    case "service": return "infart";
    default: return "gata";
  }
}

export function buildStreetGraph(roads: RoadLike[], p: ProjectionLike): StreetGraph {
  const index = new Map<string, number>();
  const nodes: Array<[number, number]> = [];
  const adjacency: Edge[][] = [];
  const { minLat, maxLat, minLng, maxLng } = p.bbox;
  const inside = (pt: { lat: number; lon: number }) => pt.lat >= minLat && pt.lat <= maxLat && pt.lon >= minLng && pt.lon <= maxLng;

  const nodeFor = (pt: { lat: number; lon: number }) => {
    const key = `${pt.lat.toFixed(7)},${pt.lon.toFixed(7)}`;
    let i = index.get(key);
    if (i === undefined) {
      i = nodes.length;
      index.set(key, i);
      nodes.push([(pt.lon - p.refLng) * p.scaleX, -(pt.lat - p.refLat) * p.scaleY]);
      adjacency.push([]);
    }
    return i;
  };

  for (const road of roads) {
    const tags = road.tags ?? {};
    if (!tags.highway || SKIP.has(tags.highway) || !road.geometry) continue;
    const name = streetName(tags);
    for (let k = 0; k < road.geometry.length - 1; k++) {
      const pa = road.geometry[k];
      const pb = road.geometry[k + 1];
      if (!inside(pa) || !inside(pb)) continue;
      const a = nodeFor(pa);
      const b = nodeFor(pb);
      if (a === b) continue;
      const length = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
      adjacency[a].push({ to: b, length, name });
      adjacency[b].push({ to: a, length, name });
    }
  }

  // Keep only the largest connected component, so every route exists.
  const comp = new Int32Array(nodes.length).fill(-1);
  let best = -1, bestSize = 0, c = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1 || adjacency[s].length === 0) continue;
    const stack = [s];
    comp[s] = c;
    let size = 0;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const e of adjacency[u]) if (comp[e.to] === -1) { comp[e.to] = c; stack.push(e.to); }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  const remap = new Int32Array(nodes.length).fill(-1);
  const keptNodes: Array<[number, number]> = [];
  nodes.forEach((n, i) => { if (comp[i] === best) { remap[i] = keptNodes.length; keptNodes.push(n); } });
  const keptAdj: Edge[][] = keptNodes.map(() => []);
  const segments: StreetGraph["segments"] = [];
  adjacency.forEach((edges, i) => {
    if (remap[i] < 0) return;
    for (const e of edges) {
      keptAdj[remap[i]].push({ to: remap[e.to], length: e.length, name: e.name });
      if (remap[i] < remap[e.to]) segments.push({ a: remap[i], b: remap[e.to], name: e.name });
    }
  });
  return { nodes: keptNodes, adjacency: keptAdj, segments };
}

export function nearestNode(g: StreetGraph, x: number, z: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = (g.nodes[i][0] - x) ** 2 + (g.nodes[i][1] - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Dijkstra – node ids from a to b (inclusive), or null if unreachable. */
export function shortestPath(g: StreetGraph, a: number, b: number): number[] | null {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap: Array<[number, number]> = [[0, a]];
  dist[a] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === b) break;
    if (d > dist[u]) continue;
    for (const e of g.adjacency[u]) {
      const nd = d + e.length;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; push([nd, e.to]); }
    }
  }
  if (!isFinite(dist[b])) return null;
  const path: number[] = [];
  for (let u = b; u !== -1; u = prev[u]) path.push(u);
  return path.reverse();
}

/** Random walk of roughly `length` units that avoids turning straight back. */
export function randomWalk(g: StreetGraph, start: number, length: number, rng: () => number): number[] {
  const path = [start];
  let walked = 0, prev = -1, u = start;
  while (walked < length) {
    const options = g.adjacency[u].filter((e) => e.to !== prev);
    const pick = (options.length ? options : g.adjacency[u])[Math.floor(rng() * (options.length || g.adjacency[u].length))];
    if (!pick) break;
    walked += pick.length;
    prev = u;
    u = pick.to;
    path.push(u);
  }
  return path;
}

/** Node ids → a path with cumulative lengths and the street names passed. */
export function toStreetPath(g: StreetGraph, ids: number[]): StreetPath {
  const points = ids.map((i) => g.nodes[i]);
  const lengths = [0];
  const streets: string[] = [];
  for (let k = 1; k < ids.length; k++) {
    const e = g.adjacency[ids[k - 1]].find((x) => x.to === ids[k]);
    lengths.push(lengths[k - 1] + (e?.length ?? Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1])));
    const name = e?.name ?? "gata";
    if (streets[streets.length - 1] !== name) streets.push(name);
  }
  return { points, lengths, total: lengths[lengths.length - 1], streets };
}

/** Position along a path after `dist` units, plus the index of the segment. */
export function pointAt(path: StreetPath, dist: number): { x: number; z: number; segment: number } {
  const d = Math.max(0, Math.min(path.total, dist));
  let k = 1;
  while (k < path.lengths.length - 1 && path.lengths[k] < d) k++;
  const a = path.points[k - 1] ?? path.points[0];
  const b = path.points[k] ?? a;
  const span = path.lengths[k] - path.lengths[k - 1] || 1;
  const t = (d - path.lengths[k - 1]) / span;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, segment: k - 1 };
}

/** Name of the nearest street within `maxDist`, or null. */
export function nearestStreetName(g: StreetGraph, x: number, z: number, maxDist = 8, namedOnly = true): string | null {
  let best: string | null = null, bestD = maxDist * maxDist;
  for (const s of g.segments) {
    if (namedOnly && /^(gata|gångväg|trappa|cykelbana|infart)$/.test(s.name)) continue;
    const [ax, az] = g.nodes[s.a];
    const [bx, bz] = g.nodes[s.b];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
    if (d < bestD) { bestD = d; best = s.name; }
  }
  return best;
}
