// Run with: npm run test:sim   (Node ≥ 23 runs TypeScript directly)
import assert from "node:assert/strict";
import { SimulatedGhostSource, riskFromEnergy } from "../src/ghost/simulation.ts";
import type { SensorDefinition } from "../src/ghost/types.ts";
import { readFileSync } from "node:fs";
import { buildStreetGraph } from "../src/ghost/streetGraph.ts";

const sensors: SensorDefinition[] = [
  { sensor_id: "A", name: "Lugn", location: "", lat: 57.698, lon: 11.95, baseline: 15, position: [0, 3, 0] },
  { sensor_id: "B", name: "Mellan", location: "", lat: 57.699, lon: 11.951, baseline: 40, position: [10, 3, 0] },
  { sensor_id: "C", name: "Hemsökt", location: "", lat: 57.697, lon: 11.952, baseline: 70, position: [20, 3, 0] },
];

let clock = 0;
const sim = new SimulatedGhostSource({ seed: 42, now: () => clock });
// Drive the simulation manually instead of with timers.
(sim as any).sensors = sensors.map((def, i) => ({ def, period: 90 + i * 20, phase: i, drift: 0, event: null, pendingEcho: null, visit: 0, node: -1, energy: def.baseline }));
(sim as any).startedAt = 0;

const TICKS = 2000;
const energy: Record<string, number[]> = { A: [], B: [], C: [] };
const eventCount: Record<string, number> = { A: 0, B: 0, C: 0 };
let echoes = 0;
const types = new Set<string>();

for (let i = 0; i < TICKS; i++) {
  clock += 5000;
  const { readings, events } = sim.tick();
  assert.equal(readings.length, 3);
  for (const r of readings) {
    assert.ok(r.ghost_energy >= 0 && r.ghost_energy <= 100, `energy out of range: ${r.ghost_energy}`);
    assert.ok(r.temperature_drop >= 0, "temperature drop must be ≥ 0");
    assert.equal(r.risk_level, riskFromEnergy(r.ghost_energy));
    assert.equal(r.timestamp, clock);
    assert.deepEqual(r.position, sensors.find((s) => s.sensor_id === r.sensor_id)!.position);
    if (r.active_event) assert.equal(r.spectral_activity, r.active_event);
    energy[r.sensor_id].push(r.ghost_energy);
  }
  for (const e of events) {
    types.add(e.type);
    if (e.echo) echoes++;
    else eventCount[e.sensor_id]++;
  }
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const meanA = mean(energy.A), meanB = mean(energy.B), meanC = mean(energy.C);
console.log("medelenergi", { A: meanA.toFixed(1), B: meanB.toFixed(1), C: meanC.toFixed(1) });
console.log("spontana händelser", eventCount, "ekon", echoes, "typer", [...types]);

assert.ok(meanA < meanB && meanB < meanC, "higher baseline should give higher mean energy");
assert.ok(eventCount.C > eventCount.A * 1.4, "more haunted places should have more spontaneous events");
assert.equal(types.size, 5, "all five event types should occur");
assert.ok(echoes > 0, "events should sometimes spread to neighbours");

// Not pure noise: consecutive readings are correlated.
const diffs = energy.B.slice(1).map((v, i) => Math.abs(v - energy.B[i]));
assert.ok(mean(diffs) < 12, `readings should change smoothly, mean step ${mean(diffs).toFixed(1)}`);
assert.ok(Math.max(...energy.C) > 85, "events should produce strong spikes");

// Timer-based API emits immediately and on interval.
const live = new SimulatedGhostSource({ intervalMs: 20, seed: 1 });
let batches = 0;
const unsub = live.subscribe(() => batches++);
live.start(sensors);
await new Promise((r) => setTimeout(r, 75));
live.stop();
unsub();
assert.ok(batches >= 3, `expected ≥3 batches, got ${batches}`);

// ── Wisps and flows on the real Haga street network ──
{
  const snap = JSON.parse(readFileSync(new URL("../public/data/haga-osm.json", import.meta.url), "utf8"));
  const bb = snap._bbox;
  const refLat = (bb.south + bb.north) / 2, refLng = (bb.west + bb.east) / 2;
  const proj = { refLat, refLng, scaleX: 51000 * Math.cos((refLat * Math.PI) / 180), scaleY: 51000, bbox: { minLat: bb.south, maxLat: bb.north, minLng: bb.west, maxLng: bb.east } };
  const roads = snap.elements.filter((e: any) => e.tags?.highway && e.geometry).map((e: any) => ({ id: e.id, tags: e.tags, geometry: e.geometry }));
  const g = buildStreetGraph(roads, proj);
  const nodeKeys = new Set(g.nodes.map(([x, z]) => `${x.toFixed(4)},${z.toFixed(4)}`));
  const at = (id: string, name: string, lat: number, lon: number, baseline: number): SensorDefinition => ({
    sensor_id: id, name, location: "", lat, lon, baseline, position: [(lon - refLng) * proj.scaleX, 5, -(lat - refLat) * proj.scaleY],
  });
  const haga = [
    at("GP-01", "Haga Nygata", 57.69852, 11.95722, 38), at("GP-02", "Skansen Kronan", 57.69601, 11.95533, 62),
    at("GP-03", "Feskekôrka", 57.70101, 11.9578, 47), at("GP-04", "Allégården", 57.69955, 11.95709, 31),
    at("GP-05", "Järntorget", 57.69988, 11.95325, 24), at("GP-06", "Mellangatan", 57.69805, 11.95385, 35),
  ];
  let now = 1_000_000;
  const s2 = new SimulatedGhostSource({ seed: 7, now: () => now });
  s2.start(haga, { streets: g });
  s2.stop();
  const messages: string[] = [];
  let maxWisps = 0, flowsChecked = 0, visitBoosts = 0;
  for (let i = 0; i < 720; i++) {
    now += 5000;
    const batch = s2.tick();
    const ents = batch.entities ?? [];
    maxWisps = Math.max(maxWisps, ents.length);
    assert.ok(ents.length >= 2, "at least two wisps are always wandering");
    assert.ok(ents.length <= 10, "wisp count is capped");
    for (const e of ents) for (const [x, z] of e.path.points) assert.ok(nodeKeys.has(`${x.toFixed(4)},${z.toFixed(4)}`), "wisps move along street nodes");
    const energy = Object.fromEntries(batch.readings.map((r) => [r.sensor_id, r.ghost_energy]));
    for (const f of batch.flows ?? []) {
      assert.ok(energy[f.from_sensor] >= energy[f.to_sensor], "energy flows from hot to cold");
      assert.ok(f.path.total > 0 && f.intensity > 0 && f.intensity <= 1);
      flowsChecked++;
    }
    for (const ev of batch.events.filter((e) => e.type === "wisp")) {
      messages.push(ev.message!);
      if (/passerade|nådde/.test(ev.message!)) visitBoosts++;
    }
  }
  const sample = (re: RegExp) => messages.find((m) => re.test(m));
  console.log("irrbloss:", { maxSamtidiga: maxWisps, händelser: messages.length, flödenKontrollerade: flowsChecked });
  console.log("  •", sample(/lämnar/));
  console.log("  •", sample(/passerade/));
  console.log("  •", sample(/nådde/));
  assert.ok(sample(/lämnar .+ mot /), "sensor events release wisps heading for another sensor");
  assert.ok(sample(/passerade/), "wisps pass sensors on the way");
  assert.ok(sample(/nådde .+ energin stiger/), "wisps reach their target");
  assert.ok(messages.some((m) => /längs (Haga Nygata|Södra Allégatan|Norra Allégatan|Pusterviksgatan|Järntorgsgatan|Kaponjärgatan|Östra Skansgatan|Haga Östergata|Mellangatan|Skolgatan)/.test(m)), "messages use real street names");
  assert.ok(visitBoosts > 10 && flowsChecked > 100);

  // A passing wisp really raises the sensor's energy
  const internal = s2 as any;
  const target = internal.sensors[0];
  const before = target.visit;
  internal.wisps = [{ id: "t", kind: "wisp", name: "Test", path: { points: [[target.def.position[0] - 30, target.def.position[2]], [target.def.position[0] + 30, target.def.position[2]]], lengths: [0, 60], total: 60, streets: ["gata"] }, speed: 10, startedAt: now, intensity: 1, travelled: 0, passed: new Set() }];
  now += 5000;
  const b2 = s2.tick();
  assert.ok(b2.events.some((e) => e.message === `Test passerade ${target.def.name}`), "passing is detected between ticks");
  assert.ok(internal.sensors[0].visit > before + 5, `visit boost applied (${before.toFixed(1)} → ${internal.sensors[0].visit.toFixed(1)})`);
}

// ── Acoustic sensor: werewolf howls follow the (real) moon ──
{
  const mic: SensorDefinition = { sensor_id: "LJ-01", name: "Skansparken", location: "", lat: 57.6968, lon: 11.9547, baseline: 0, position: [0, 3, 0] };
  const run = (moon: number, wind: number) => {
    let now = 0;
    const sim = new SimulatedGhostSource({ seed: 11, now: () => now });
    sim.start(sensors, { acoustic: [mic], environment: () => ({ moon, wind }) });
    sim.stop();
    let howls = 0, maxDb = 0, minDb = 999, quietSum = 0, quietN = 0;
    for (let i = 0; i < 3000; i++) {
      now += 5000;
      const b = sim.tick();
      const a = b.acoustic![0];
      howls += b.events.filter((e) => e.type === "howl").length;
      maxDb = Math.max(maxDb, a.level_db); minDb = Math.min(minDb, a.level_db);
      if (!a.howl) { quietSum += a.level_db; quietN++; }
      for (const e of b.events.filter((e) => e.type === "howl")) assert.match(e.message!, /^Varulvsylande vid Skansparken – \d+ dB, \d+ Hz/);
    }
    return { howls, maxDb, minDb, quiet: quietSum / quietN };
  };
  const full = run(1, 3), newMoon = run(0, 3), windy = run(1, 15);
  console.log("ylanden på 4 h:", { fullmåne: full.howls, nymåne: newMoon.howls }, "tyst nivå:", full.quiet.toFixed(1), "dB, blåsigt:", windy.quiet.toFixed(1), "dB, max", full.maxDb, "dB");
  assert.ok(full.howls > newMoon.howls * 4, "full moon → many more howls");
  assert.ok(full.quiet > 30 && full.quiet < 45, "a quiet night park is ~35 dB");
  assert.ok(windy.quiet > full.quiet + 10, "wind raises the background noise");
  assert.ok(full.maxDb > 75 && full.maxDb <= 100, "howls are loud");
}

console.log("✓ Alla simuleringstester passerade");
