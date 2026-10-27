// SMHI open point forecast ("snow1g"), CC BY 4.0, no API key, CORS enabled.
// https://opendata.smhi.se/  – updated hourly.
import type { WeatherNow, WeatherSource } from "./types.ts";

const BASE = "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point";

type SmhiStep = { time: string; data: Record<string, number> };
type SmhiResponse = { createdTime: string; timeSeries: SmhiStep[] };

/** Picks the forecast step closest to `now` and maps it to WeatherNow. Pure – used by tests. */
export function parseSmhi(json: SmhiResponse, now = Date.now()): WeatherNow {
  const steps = json.timeSeries ?? [];
  if (steps.length === 0) throw new Error("SMHI: empty time series");
  let best = steps[0];
  for (const s of steps) {
    if (Math.abs(Date.parse(s.time) - now) < Math.abs(Date.parse(best.time) - now)) best = s;
  }
  const d = best.data;
  // SMHI marks missing values with exactly -9 (real temperatures can be lower than that).
  const num = (k: string, fallback = 0) => (typeof d[k] === "number" && d[k] !== -9 ? d[k] : fallback);

  // Total cloud cover in octas (0–8). The per-layer values don't add up to it, so use the total
  // (it agrees with SMHI's weather symbol); fall back to the largest layer if it is missing.
  const octas = num("cloud_area_fraction", Math.max(num("low_type_cloud_area_fraction"), num("medium_type_cloud_area_fraction"), num("high_type_cloud_area_fraction")));
  const temperature = num("air_temperature", 10);
  const frozenPart = d.precipitation_frozen_part;
  const frozenFraction = typeof frozenPart === "number" && frozenPart >= 0 ? Math.min(1, frozenPart) : temperature <= 0.5 ? 1 : 0;

  return {
    time: Date.parse(best.time),
    issued: Date.parse(json.createdTime),
    temperature,
    windSpeed: num("wind_speed"),
    windGust: num("wind_speed_of_gust", num("wind_speed")),
    windFrom: num("wind_from_direction"),
    cloudCover: Math.min(1, octas / 8),
    visibilityKm: num("visibility_in_air", 20),
    precipitation: Math.max(num("precipitation_amount_mean"), num("precipitation_amount_mean_deterministic")),
    frozenFraction,
    thunderProbability: num("thunderstorm_probability"),
    symbol: num("symbol_code", 1),
    source: "SMHI",
  };
}

export class SmhiWeatherSource implements WeatherSource {
  readonly attribution = "Väderdata: SMHI (CC BY 4.0)";

  async fetchNow(lat: number, lon: number): Promise<WeatherNow> {
    const res = await fetch(`${BASE}/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`);
    if (!res.ok) throw new Error(`SMHI svarade ${res.status}`);
    return parseSmhi(await res.json());
  }
}

/** Swedish names and icons for SMHI weather symbols (Wsymb2). */
export const SYMBOLS: Record<number, [string, string]> = {
  1: ["☀️", "Klart"], 2: ["🌤", "Nästan klart"], 3: ["⛅", "Växlande molnighet"], 4: ["⛅", "Halvklart"],
  5: ["☁️", "Molnigt"], 6: ["☁️", "Mulet"], 7: ["🌫", "Dimma"], 8: ["🌦", "Lätta regnskurar"],
  9: ["🌦", "Regnskurar"], 10: ["🌧", "Kraftiga regnskurar"], 11: ["⛈", "Åskskurar"], 12: ["🌨", "Lätta byar av snöblandat regn"],
  13: ["🌨", "Byar av snöblandat regn"], 14: ["🌨", "Kraftiga byar av snöblandat regn"], 15: ["🌨", "Lätta snöbyar"], 16: ["🌨", "Snöbyar"],
  17: ["❄️", "Kraftiga snöbyar"], 18: ["🌧", "Lätt regn"], 19: ["🌧", "Regn"], 20: ["🌧", "Kraftigt regn"],
  21: ["⛈", "Åska"], 22: ["🌨", "Lätt snöblandat regn"], 23: ["🌨", "Snöblandat regn"], 24: ["🌨", "Kraftigt snöblandat regn"],
  25: ["🌨", "Lätt snöfall"], 26: ["❄️", "Snöfall"], 27: ["❄️", "Kraftigt snöfall"],
};

/** Compass point for the direction the wind comes from (Swedish). */
export function compass(fromDeg: number): string {
  const names = ["N", "NO", "O", "SO", "S", "SV", "V", "NV"];
  return names[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}
