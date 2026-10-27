// Run with: npm run test:opendata
import assert from "node:assert/strict";
import { moonAge, moonIllumination, moonPhaseName, daysToFullMoon } from "../src/opendata/moon.ts";
import { parseAirSensors, interpolatePm25, pmLabel } from "../src/opendata/airSensors.ts";
import { mergePages } from "../src/opendata/wikipedia.ts";

// Moon: full moon 26 Oct 2026 04:12 UTC, new moon 9 Nov 2026 07:02 UTC
const full = new Date(Date.UTC(2026, 9, 26, 4, 12));
const fresh = new Date(Date.UTC(2026, 10, 9, 7, 2));
assert.ok(moonIllumination(full) > 0.99, "full moon is fully lit");
assert.equal(moonPhaseName(full), "Fullmåne");
assert.ok(moonIllumination(fresh) < 0.01 && moonPhaseName(fresh) === "Nymåne");
assert.ok(Math.abs(daysToFullMoon(new Date(Date.UTC(2026, 9, 20))) - 6.2) < 0.5);
const halloween = new Date(Date.UTC(2026, 9, 31, 20, 0));
console.log(`Halloween 2026: ${moonPhaseName(halloween)}, ${Math.round(moonIllumination(halloween) * 100)} % belyst`);
assert.ok(moonAge(halloween) > 0.5, "waning on Halloween");

// Air sensors: two sensor types at the same location merge into one station; indoor skipped
const rows = [
  { timestamp: "2026-10-27 06:00:00", location: { latitude: "57.70", longitude: "11.95", id: 1 }, sensor: { id: 10, sensor_type: { name: "SDS011" } }, sensordatavalues: [{ value: "4.2", value_type: "P2" }, { value: "8.0", value_type: "P1" }] },
  { timestamp: "2026-10-27 06:02:00", location: { latitude: "57.70", longitude: "11.95", id: 1 }, sensor: { id: 11, sensor_type: { name: "DHT22" } }, sensordatavalues: [{ value: "9.5", value_type: "temperature" }, { value: "88", value_type: "humidity" }] },
  { timestamp: "2026-10-27 06:00:00", location: { latitude: "57.69", longitude: "11.96", id: 2, indoor: 1 }, sensor: { id: 12, sensor_type: { name: "SDS011" } }, sensordatavalues: [{ value: "50", value_type: "P2" }] },
  { timestamp: "2026-10-27 06:00:00", location: { latitude: "57.71", longitude: "11.97", id: 3 }, sensor: { id: 13, sensor_type: { name: "SDS011" } }, sensordatavalues: [{ value: "999999", value_type: "P2" }] },
];
const st = parseAirSensors(rows as any);
assert.equal(st.length, 2, "merged per location, indoor dropped");
const s1 = st.find((s) => s.id === "1")!;
assert.deepEqual([s1.pm25, s1.pm10, s1.temperature, s1.humidity], [4.2, 8, 9.5, 88]);
assert.equal(st.find((s) => s.id === "3")!.pm25, undefined, "absurd values ignored");
assert.equal(interpolatePm25(st, 57.70, 11.95)!.toFixed(1), "4.2");
assert.equal(pmLabel(4.2), "Mycket bra");

// Wikipedia: continued responses fill in extracts for pages seen earlier
const m = new Map();
mergePages(m, [{ pageid: 1, title: "Skansen Kronan", coordinates: [{ lat: 57.696, lon: 11.955 }], fullurl: "u" }]);
mergePages(m, [{ pageid: 1, title: "Skansen Kronan", extract: "En försvarsanläggning." }]);
assert.equal(m.get(1).extract, "En försvarsanläggning.");
assert.equal(m.get(1).lat, 57.696, "coordinates kept from the first response");

console.log("✓ Alla öppendatatester passerade");
