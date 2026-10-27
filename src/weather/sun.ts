// Solar position (simplified NOAA / Astronomical Almanac formulas, ±0.5°).
// No dependencies – good enough to light the scene like the real sky over Haga.

const RAD = Math.PI / 180;

/** Elevation above the horizon and azimuth (0 = north, 90 = east), both in degrees. */
export function sunPosition(date: Date, lat: number, lon: number): { elevation: number; azimuth: number } {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const lst = (gmst * 15 + lon) * RAD;
  const h = lst - ra; // hour angle
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  const azimuth = Math.atan2(-Math.sin(h), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(h));
  return { elevation: elevation / RAD, azimuth: ((azimuth / RAD) + 360) % 360 };
}

/** Unit vector towards the sun in scene axes (x = east, y = up, z = south). */
export function sunDirection(elevation: number, azimuth: number): [number, number, number] {
  const el = elevation * RAD;
  const az = azimuth * RAD;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

/**
 * Sunrise and sunset for the local day of `date` (standard −0.833° horizon),
 * found by scanning minute by minute. Null when the sun doesn't cross the horizon.
 */
export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date | null; sunset: Date | null } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let prev = sunPosition(start, lat, lon).elevation > -0.833;
  for (let m = 1; m <= 24 * 60; m++) {
    const t = new Date(start.getTime() + m * 60000);
    const up = sunPosition(t, lat, lon).elevation > -0.833;
    if (up && !prev && !sunrise) sunrise = t;
    if (!up && prev && !sunset) sunset = t;
    prev = up;
  }
  return { sunrise, sunset };
}
