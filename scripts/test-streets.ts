// Run with: npm run test:streets
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStreetGraph, nearestNode, nearestStreetName, pointAt, randomWalk, shortestPath, toStreetPath } from "../src/ghost/streetGraph.ts";
import { mulberry32 } from "../src/ghost/simulation.ts";

const snap = JSON.parse(readFileSync(new URL("../public/data/haga-osm.json", import.meta.url), "utf8"));
const b = snap._bbox;
const refLat = (b.south + b.north) / 2, refLng = (b.west + b.east) / 2;
const p = { refLat, refLng, scaleX: 51000 * Math.cos((refLat * Math.PI) / 180), scaleY: 51000, bbox: { minLat: b.south, maxLat: b.north, minLng: b.west, maxLng: b.east } };
const roads = snap.elements.filter((e: any) => e.tags?.highway && e.geometry).map((e: any) => ({ id: e.id, tags: e.tags, geometry: e.geometry }));
const world = (lat: number, lon: number): [number, number] => [(lon - refLng) * p.scaleX, -(lat - refLat) * p.scaleY];

const g = buildStreetGraph(roads, p);
console.log(`gatunät: ${g.nodes.length} noder, ${g.segments.length} segment`);
assert.ok(g.nodes.length > 500, "Haga should give a sizeable street network");

const sensors: Record<string, [number, number]> = {
  "Haga Nygata": world(57.69852, 11.95722), "Skansen Kronan": world(57.69601, 11.95533), "Feskekôrka": world(57.70101, 11.9578),
  "Allégården": world(57.69955, 11.95709), "Järntorget": world(57.69988, 11.95325), "Mellangatan": world(57.69805, 11.95385),
};
const ids = Object.fromEntries(Object.entries(sensors).map(([k, [x, z]]) => [k, nearestNode(g, x, z)]));
for (const [k, [x, z]] of Object.entries(sensors)) {
  const [nx, nz] = g.nodes[ids[k]];
  // Feskekôrka is on the north bank; with only a footbridge inside the area, the
  // nearest connected street is the south quay right across the canal (~65 m).
  assert.ok(Math.hypot(nx - x, nz - z) < 35, `${k}: a street node should be close by`);
}

const route = shortestPath(g, ids["Järntorget"], ids["Feskekôrka"]);
assert.ok(route, "route Järntorget → Feskekôrka exists");
const path = toStreetPath(g, route!);
const straight = Math.hypot(sensors["Järntorget"][0] - sensors["Feskekôrka"][0], sensors["Järntorget"][1] - sensors["Feskekôrka"][1]);
console.log(`Järntorget → Feskekôrka: ${(path.total * 2.183).toFixed(0)} m längs gatorna (fågelvägen ${(straight * 2.183).toFixed(0)} m), via ${path.streets.filter((s) => !/^(gata|gångväg)$/.test(s)).slice(0, 5).join(", ")}`);
assert.ok(path.total >= straight * 0.95 && path.total < straight * 2.5, "route length should be plausible");
for (let k = 1; k < route!.length; k++) assert.ok(g.adjacency[route![k - 1]].some((e) => e.to === route![k]), "route follows edges");

// All sensor pairs are connected
const names = Object.keys(ids);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert.ok(shortestPath(g, ids[names[i]], ids[names[j]]), `${names[i]} ↔ ${names[j]}`);

// pointAt walks the path
const mid = pointAt(path, path.total / 2);
assert.ok(isFinite(mid.x) && isFinite(mid.z));
assert.deepEqual([pointAt(path, 0).x, pointAt(path, 0).z], path.points[0]);

// Random walks stay on the network
const walk = randomWalk(g, ids["Haga Nygata"], 150, mulberry32(3));
assert.ok(toStreetPath(g, walk).total >= 150);

// Street name lookup: a point in the middle of Haga Nygata (taken from OSM itself)
const hn = roads.find((r: any) => r.tags.name === "Haga Nygata" && r.geometry.length >= 3);
const mp = hn.geometry[Math.floor(hn.geometry.length / 2)];
const name = nearestStreetName(g, ...world(mp.lat, mp.lon), 6);
console.log("gatan mitt på Haga Nygata:", name, "| vid sensorn GP-01 (hörnhus):", nearestStreetName(g, ...sensors["Haga Nygata"], 15));
assert.equal(name, "Haga Nygata");

console.log("✓ Alla gatunätstester passerade");
