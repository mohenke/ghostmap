// ── Weather – shared types ─────────────────────────────────────────────────
// Independent of React/Three.js so the source can be swapped (SMHI today).

export type WeatherNow = {
  /** Valid time of the forecast step (ms since epoch). */
  time: number;
  /** When the source produced the data (ms since epoch). */
  issued: number;
  temperature: number; // °C
  windSpeed: number; // m/s
  windGust: number; // m/s
  /** Direction the wind comes FROM, degrees (0 = north, 90 = east). */
  windFrom: number;
  /** 0–1 */
  cloudCover: number;
  visibilityKm: number;
  /** Precipitation intensity, mm/h */
  precipitation: number;
  /** 0 = rain, 1 = snow */
  frozenFraction: number;
  /** 0–100 % */
  thunderProbability: number;
  /** SMHI weather symbol (Wsymb2, 1–27) */
  symbol: number;
  /** Data source label shown in the UI */
  source: string;
};

export interface WeatherSource {
  /** Latest weather for a point. */
  fetchNow(lat: number, lon: number): Promise<WeatherNow>;
  /** Attribution text required by the data licence. */
  readonly attribution: string;
}
