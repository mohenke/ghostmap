import { useEffect } from "react";
import { create } from "zustand";
import { SmhiWeatherSource } from "./smhi.ts";
import type { WeatherNow, WeatherSource } from "./types.ts";

/** Haga, Göteborg – where the weather is fetched for. */
export const WEATHER_POINT = { lat: 57.6985, lon: 11.957 };
const REFRESH_MS = 15 * 60 * 1000;

/** Calm, dry weather used until real data arrives (or if it fails). */
export const NEUTRAL_WEATHER: WeatherNow = {
  time: Date.now(), issued: Date.now(), temperature: 10, windSpeed: 3, windGust: 5, windFrom: 240,
  cloudCover: 0.3, visibilityKm: 20, precipitation: 0, frozenFraction: 0, thunderProbability: 0, symbol: 3, source: "–",
};

// Hidden test aid: ?weather=rain|snow|fog|storm overrides the live data.
const PRESETS: Record<string, Partial<WeatherNow>> = {
  rain: { precipitation: 3, cloudCover: 1, visibilityKm: 6, windSpeed: 7, windGust: 12, windFrom: 230, temperature: 9, symbol: 19 },
  snow: { precipitation: 1.5, frozenFraction: 1, cloudCover: 1, visibilityKm: 2.5, windSpeed: 4, windGust: 7, windFrom: 20, temperature: -2, symbol: 26 },
  fog: { precipitation: 0, cloudCover: 1, visibilityKm: 0.8, windSpeed: 1, windGust: 2, temperature: 6, symbol: 7 },
  storm: { precipitation: 8, cloudCover: 1, visibilityKm: 3, windSpeed: 20, windGust: 31, windFrom: 250, thunderProbability: 85, temperature: 8, symbol: 21 },
};

type WeatherStore = {
  weather: WeatherNow;
  status: "loading" | "live" | "simulated" | "error";
  attribution: string;
  setWeather: (w: WeatherNow, status: WeatherStore["status"]) => void;
  setStatus: (s: WeatherStore["status"]) => void;
};

export const useWeatherStore = create<WeatherStore>((set) => ({
  weather: NEUTRAL_WEATHER,
  status: "loading",
  attribution: "Väderdata: SMHI (CC BY 4.0)",
  setWeather: (weather, status) => set({ weather, status }),
  setStatus: (status) => set({ status }),
}));

/** Keeps the weather store up to date. Mount once (in App). */
export function useWeatherFeed(source: WeatherSource = new SmhiWeatherSource()) {
  useEffect(() => {
    const preset = new URLSearchParams(location.search).get("weather");
    if (preset && PRESETS[preset]) {
      useWeatherStore.getState().setWeather({ ...NEUTRAL_WEATHER, ...PRESETS[preset], source: `simulerat: ${preset}` }, "simulated");
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const w = await source.fetchNow(WEATHER_POINT.lat, WEATHER_POINT.lon);
        if (!cancelled) useWeatherStore.getState().setWeather(w, "live");
      } catch (err) {
        console.warn("Weather unavailable – using calm default weather.", err);
        if (!cancelled) useWeatherStore.getState().setStatus("error");
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // the source is created once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
