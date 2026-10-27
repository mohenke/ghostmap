// Run with: npm run test:walk
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCollider } from "../src/walk/collision.ts";

const snap = JSON.parse(readFileSync(new URL("../public/data/haga-osm.json", import.meta.url), "utf8"));
const b = snap._bbox;
const refLat = (b.south + b.north) / 2, refLng = (b.west + b.east) / 2;
const p = { refLat, refLng, scaleX: 51000 * Math.cos((refLat * Math.PI) / 180), scaleY: 51000, bbox: { minLat: b.south, maxLat: b.north, minLng: b.west, maxLng: b.east } };
const world = (lat: number, lon: number): [number, number] => [(lon - refLng) * p.scaleX, -(lat - refLat) * p.scaleY];

const buildings = snap.elements.filter((e: any) => e.tags?.building && e.geometry).map((e: any) => ({ geometry: e.geometry }));
const water = snap.elements.filter((e: any) => e.tags?.natural === "water" && e.geometry).map((e: any) => ({ ring: e.geometry }));
const bridges = snap.elements.filter((e: any) => e.tags?.bridge === "yes" && e.tags?.highway && e.geometry).map((e: any) => ({ geometry: e.geometry, halfWidth: 1.5 }));
const c = buildCollider(p, buildings, water, bridges);
const R = 0.3;

// Inside a building (centroid of a big, simple footprint)
const big = snap.elements.find((e: any) => e.tags?.building === "apartments" && e.geometry?.length >= 5 && e.geometry.length <= 8);
const cen = big.geometry.reduce((s: any, q: any) => ({ lat: s.lat + q.lat / big.geometry.length, lon: s.lon + q.lon / big.geometry.length }), { lat: 0, lon: 0 });
assert.equal(c.blocked(...world(cen.lat, cen.lon), R), true, "inside a building is blocked");

// Middle of Haga Nygata is free
const hn = snap.elements.find((e: any) => e.tags?.name === "Haga Nygata" && e.geometry?.length >= 3);
const mid = hn.geometry[Math.floor(hn.geometry.length / 2)];
const [sx, sz] = world(mid.lat, mid.lon);
assert.equal(c.blocked(sx, sz, R), false, "Haga Nygata is walkable");

// Walk 120 steps north and 120 steps east from the street: never end up inside a building
for (const [dx, dz] of [[0, -0.2], [0.2, 0], [0.14, 0.14], [-0.2, 0]]) {
  let x = sx, z = sz;
  for (let i = 0; i < 120; i++) [x, z] = c.move(x, z, dx, dz, R);
  assert.equal(c.blocked(x, z, R), false, "movement never ends inside an obstacle");
}

// Sliding: walking diagonally into a wall still makes progress along it
let x = sx, z = sz, moved = 0;
for (let i = 0; i < 200; i++) { const [nx, nz] = c.move(x, z, 0.2, 0.1, R); moved += Math.hypot(nx - x, nz - z); x = nx; z = nz; }
console.log(`glidning: gick ${(moved * 2.183).toFixed(0)} m utan att gå in i något hus`);
assert.ok(moved > 5, "sliding along walls keeps you moving");

// Area bounds
assert.equal(c.blocked(c.bounds.maxX + 5, 0, R), true, "cannot leave the area");
console.log("✓ Alla kollisionstester passerade");
