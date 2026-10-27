// Run with: npm run test:weather
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sunPosition, sunTimes } from "../src/weather/sun.ts";
import { compass, parseSmhi } from "../src/weather/smhi.ts";

const HAGA = { lat: 57.6985, lon: 11.957 };

// Sunset in Göteborg on 26 Oct 2026 is about 16:47 local time (CET = UTC+1).
let sunset: Date | null = null;
for (let m = 14 * 60; m < 18 * 60; m++) {
  const t = new Date(Date.UTC(2026, 9, 26, 0, m)); // minutes after midnight UTC
  if (sunPosition(t, HAGA.lat, HAGA.lon).elevation < -0.833) { sunset = t; break; }
}
assert.ok(sunset, "sun should set");
const local = sunset!.getUTCHours() + 1 + sunset!.getUTCMinutes() / 60;
console.log("solnedgång Haga 26 okt:", `${Math.floor(local)}:${String(sunset!.getUTCMinutes()).padStart(2, "0")}`);
assert.ok(local > 16.6 && local < 17.0, `sunset should be ~16:47, got ${local.toFixed(2)}`);

// sunTimes agrees with the scan above (local day in the test machine's time zone)
const times = sunTimes(new Date(Date.UTC(2026, 9, 26, 10, 0)), HAGA.lat, HAGA.lon);
assert.ok(times.sunrise && times.sunset, "sun rises and sets");
assert.ok(Math.abs(times.sunset!.getTime() - sunset!.getTime()) <= 60000, "sunTimes sunset matches");
console.log("soluppgång/nedgång:", times.sunrise!.toISOString().slice(11, 16), "/", times.sunset!.toISOString().slice(11, 16), "UTC");

// Noon: sun roughly south (azimuth ~180°), low in late October (~19°).
const noon = sunPosition(new Date(Date.UTC(2026, 9, 26, 11, 15)), HAGA.lat, HAGA.lon);
console.log("middag:", noon);
assert.ok(Math.abs(noon.azimuth - 180) < 10, "noon sun should be in the south");
assert.ok(noon.elevation > 15 && noon.elevation < 23, "late-October noon sun is low");

// SMHI parsing with a real response.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/smhi-haga.json", import.meta.url), "utf8"));
const first = Date.parse(fixture.timeSeries[0].time);
const w = parseSmhi(fixture, first + 10 * 60 * 1000);
console.log("SMHI:", w);
assert.equal(w.time, first, "picks the closest step");
assert.equal(w.cloudCover, 1 / 8, "uses total cloud cover (agrees with symbol 1 = clear)");
assert.ok(w.visibilityKm > 0);
assert.ok(w.windFrom >= 0 && w.windFrom <= 360);
assert.ok(w.frozenFraction === 0 || w.frozenFraction === 1 || (w.frozenFraction > 0 && w.frozenFraction < 1));
// Real sub-zero values must survive; -9 means "missing".
const cold = parseSmhi({ createdTime: fixture.createdTime, timeSeries: [{ time: fixture.timeSeries[0].time, data: { ...fixture.timeSeries[0].data, air_temperature: -12.4, visibility_in_air: -9 } }] });
assert.equal(cold.temperature, -12.4);
assert.equal(cold.visibilityKm, 20, "missing visibility falls back to 20 km");
assert.equal(cold.frozenFraction, 1, "no precipitation_frozen_part → snow when below 0.5 °C");
assert.equal(compass(253), "V");
assert.equal(compass(10), "N");
assert.equal(compass(135), "SO");

console.log("✓ Alla vädertester passerade");
