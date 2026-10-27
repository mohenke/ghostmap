// Moon position and phase (simplified lunar theory, ~0.5° / a few minutes –
// plenty for lighting a scene). No dependencies.
import { sunPosition } from "../weather/sun.ts";

const RAD = Math.PI / 180;
const SYNODIC = 29.530588853; // days
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // reference new moon

/** 0 = new moon, 0.5 = full moon, → 1 = next new moon. */
export function moonAge(date: Date): number {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  return (((days / SYNODIC) % 1) + 1) % 1;
}

/** Illuminated fraction 0–1. */
export function moonIllumination(date: Date): number {
  return (1 - Math.cos(2 * Math.PI * moonAge(date))) / 2;
}

export function moonPhaseName(date: Date): string {
  const a = moonAge(date);
  if (a < 0.03 || a > 0.97) return "Nymåne";
  if (a < 0.22) return "Tilltagande skära";
  if (a < 0.28) return "Första kvarteret";
  if (a < 0.47) return "Tilltagande måne";
  if (a < 0.53) return "Fullmåne";
  if (a < 0.72) return "Avtagande måne";
  if (a < 0.78) return "Sista kvarteret";
  return "Avtagande skära";
}

/** Days until the next full moon (0 when it is full right now). */
export function daysToFullMoon(date: Date): number {
  const a = moonAge(date);
  return ((0.5 - a + 1) % 1) * SYNODIC;
}

/** Elevation and azimuth (0 = north, 90 = east) in degrees. */
export function moonPosition(date: Date, lat: number, lon: number): { elevation: number; azimuth: number } {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const L = (218.316 + 13.176396 * d) * RAD; // mean longitude
  const M = (134.963 + 13.064993 * d) * RAD; // mean anomaly
  const F = (93.272 + 13.22935 * d) * RAD; // argument of latitude
  const lng = L + 6.289 * RAD * Math.sin(M); // ecliptic longitude
  const latE = 5.128 * RAD * Math.sin(F); // ecliptic latitude
  const e = 23.4397 * RAD;
  const ra = Math.atan2(Math.sin(lng) * Math.cos(e) - Math.tan(latE) * Math.sin(e), Math.cos(lng));
  const dec = Math.asin(Math.sin(latE) * Math.cos(e) + Math.cos(latE) * Math.sin(e) * Math.sin(lng));
  const gmst = 18.697374558 + 24.06570982441908 * d;
  const h = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));
  const azimuth = Math.atan2(-Math.sin(h), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(h));
  return { elevation: elevation / RAD, azimuth: (azimuth / RAD + 360) % 360 };
}

/** Is the moon's bright side to the west (waxing, evening) – used to shade the sprite. */
export function moonWaxing(date: Date): boolean {
  return moonAge(date) < 0.5;
}

/** Just re-exported so callers can compare sun and moon. */
export { sunPosition };
